begin;

create or replace function private.refresh_operational_import_batch(p_import_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  summary jsonb;
  valid_count integer;
  invalid_count integer;
  pending_category_count integer;
  next_status public.import_status;
begin
  select jsonb_build_object(
    'TOTAL', count(*)::integer,
    'VALID', count(*) filter (where validation_state in ('VALID', 'WARNING'))::integer,
    'INVALID', count(*) filter (where validation_state in ('ERROR', 'CONFLICT'))::integer,
    'NEW', count(*) filter (where dry_run_action = 'NEW')::integer,
    'UPDATE_CANDIDATE', count(*) filter (where dry_run_action = 'UPDATE_CANDIDATE')::integer,
    'CONFLICT', count(*) filter (where validation_state = 'CONFLICT')::integer,
    'IGNORED', count(*) filter (where validation_state = 'IGNORED')::integer,
    'WARNING', count(*) filter (where validation_state = 'WARNING')::integer,
    'CATEGORIES_NEW', count(distinct lower(btrim(category_candidate ->> 'normalizedName')))
      filter (where category_candidate is not null and validation_state <> 'IGNORED')::integer,
    'POSITIVE', count(*) filter (
      where operational_preview ->> 'movementType' = 'ADJUSTMENT_POSITIVE'
    )::integer,
    'NEGATIVE', count(*) filter (
      where operational_preview ->> 'movementType' = 'ADJUSTMENT_NEGATIVE'
    )::integer,
    'UNCHANGED', count(*) filter (
      where operational_preview ->> 'movementType' is null
        and operational_preview ? 'difference'
    )::integer
  ),
  count(*) filter (where validation_state in ('VALID', 'WARNING'))::integer,
  count(*) filter (where validation_state in ('ERROR', 'CONFLICT'))::integer,
  count(*) filter (
    where category_candidate is not null
      and coalesce((category_candidate ->> 'approvedForCreation')::boolean, false) = false
      and validation_state <> 'IGNORED'
  )::integer
  into summary, valid_count, invalid_count, pending_category_count
  from public.import_rows
  where import_batch_id = p_import_batch_id;

  next_status := case
    when invalid_count = 0 and pending_category_count = 0 then 'READY'::public.import_status
    else 'PENDING_MAPPING'::public.import_status
  end;

  update public.import_batches
  set
    total_rows = (summary ->> 'TOTAL')::integer,
    valid_rows = valid_count,
    invalid_rows = invalid_count,
    dry_run_summary = summary,
    status = next_status
  where id = p_import_batch_id;

  return summary;
end;
$$;

create function public.stage_product_import_preview(
  p_mode public.product_import_mode,
  p_source_type text,
  p_source_name text,
  p_original_filename text,
  p_file_hash text,
  p_file_size_bytes bigint,
  p_detected_headers jsonb,
  p_column_mapping jsonb,
  p_value_mapping jsonb,
  p_rows jsonb,
  p_duplicate_of_batch_id uuid default null
)
returns table (batch_id uuid, status public.import_status, summary jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  created_batch_id uuid;
  original_batch_id uuid;
  input_row jsonb;
  normalized jsonb;
  issues jsonb;
  suggestions jsonb;
  candidate jsonb;
  row_number_value integer;
  state_value public.import_row_validation_state;
  action_value public.import_row_dry_run_action;
  resolved_id uuid;
  matched_ids uuid[];
  final_summary jsonb;
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then
    raise exception using errcode = '42501', message = 'active ADMIN user is required';
  end if;
  if p_mode is null
    or p_source_type not in ('CSV', 'XLSX')
    or nullif(btrim(p_source_name), '') is null
    or nullif(btrim(p_original_filename), '') is null
    or nullif(btrim(p_file_hash), '') is null
    or p_file_size_bytes is null
    or p_file_size_bytes <= 0
  then
    raise exception using errcode = '22023', message = 'invalid product import metadata';
  end if;
  if jsonb_typeof(p_detected_headers) <> 'array'
    or jsonb_array_length(p_detected_headers) = 0
    or jsonb_typeof(p_column_mapping) <> 'array'
    or jsonb_typeof(p_value_mapping) <> 'object'
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 10000
  then
    raise exception using errcode = '22023', message = 'headers, mapping, values or rows are invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_column_mapping) mapping
    where not exists (
      select 1
      from jsonb_array_elements_text(p_detected_headers) header
      where header = mapping ->> 'sourceColumn'
    )
  ) or exists (
    select 1
    from jsonb_array_elements_text(p_detected_headers) header
    where (
      select count(*)
      from jsonb_array_elements(p_column_mapping) mapping
      where mapping ->> 'sourceColumn' = header
    ) <> 1
  ) or exists (
    select mapping ->> 'targetField'
    from jsonb_array_elements(p_column_mapping) mapping
    where mapping ->> 'targetField' <> 'IGNORE'
    group by mapping ->> 'targetField'
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'every source column must have one unique mapping decision';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_column_mapping) mapping
    where mapping ->> 'targetField' <> 'IGNORE'
      and mapping ->> 'targetField' not in (
        'sku', 'name', 'ean', 'external_id', 'opening_quantity',
        'minimum_quantity', 'unit', 'category', 'product_type'
      )
  ) then
    raise exception using errcode = '22023', message = 'unsupported product mapping target';
  end if;
  if exists (
    select 1
    from unnest(array['sku', 'name', 'unit', 'category', 'product_type']) required(target)
    where not exists (
      select 1
      from jsonb_array_elements(p_column_mapping) mapping
      where mapping ->> 'targetField' = required.target
    )
  ) then
    raise exception using errcode = '22023', message = 'required product mapping target is missing';
  end if;
  if p_mode = 'MASTER_DATA_IMPORT' and (
    exists (
      select 1
      from jsonb_array_elements(p_column_mapping) mapping
      where mapping ->> 'targetField' = 'opening_quantity'
    )
    or exists (
      select 1
      from jsonb_array_elements(p_rows) staged
      where coalesce(staged -> 'normalizedData', '{}'::jsonb) ? 'opening_quantity'
        and nullif(staged -> 'normalizedData' ->> 'opening_quantity', '') is not null
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'stock quantity is forbidden in master-data imports; use reconciliation';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('product-import-wizard:file:' || btrim(p_file_hash), 0)
  );
  select id
  into original_batch_id
  from public.import_batches
  where file_hash = btrim(p_file_hash)
    and duplicate_of_batch_id is null
    and status not in ('FAILED', 'CANCELLED')
  order by created_at
  limit 1;
  if original_batch_id is not null
    and p_duplicate_of_batch_id is distinct from original_batch_id
  then
    raise exception using
      errcode = '23505',
      message = 'file already has an import batch; explicit duplicate approval is required';
  end if;
  if original_batch_id is null and p_duplicate_of_batch_id is not null then
    raise exception using errcode = '22023', message = 'duplicate batch does not match this file';
  end if;

  insert into public.import_batches (
    source_type,
    source_name,
    original_filename,
    file_hash,
    file_size_bytes,
    status,
    created_by,
    detected_headers,
    column_mapping,
    value_mapping,
    duplicate_of_batch_id,
    product_import_mode,
    operational_import_type,
    metadata
  ) values (
    p_source_type,
    btrim(p_source_name),
    btrim(p_original_filename),
    btrim(p_file_hash),
    p_file_size_bytes,
    'VALIDATING',
    actor_id,
    p_detected_headers,
    p_column_mapping,
    p_value_mapping,
    p_duplicate_of_batch_id,
    p_mode,
    'PRODUCTS',
    jsonb_build_object('flow', 'PRODUCT_IMPORT_WIZARD', 'schema_version', 1)
  ) returning id into created_batch_id;

  for input_row in select value from jsonb_array_elements(p_rows) loop
    row_number_value := (input_row ->> 'rowNumber')::integer;
    normalized := input_row -> 'normalizedData';
    issues := coalesce(input_row -> 'validationErrors', '[]'::jsonb);
    suggestions := '[]'::jsonb;
    candidate := null;
    resolved_id := null;
    matched_ids := '{}'::uuid[];

    if row_number_value is null
      or row_number_value <= 0
      or jsonb_typeof(issues) <> 'array'
    then
      raise exception using errcode = '22023', message = 'invalid staged row';
    end if;

    if coalesce((input_row ->> 'ignored')::boolean, false) then
      state_value := 'IGNORED';
      action_value := 'IGNORED';
    elsif normalized is null or jsonb_typeof(normalized) <> 'object' then
      state_value := 'ERROR';
      action_value := null;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'INVALID_NORMALIZED_ROW',
        'severity', 'ERROR',
        'field', 'row',
        'problem', 'Linha normalizada inválida.',
        'suggestedCorrection', 'Revise o mapeamento e os valores da linha.'
      ));
    else
      if nullif(btrim(normalized ->> 'sku'), '') is null
        or nullif(btrim(normalized ->> 'name'), '') is null
        or nullif(btrim(normalized ->> 'category'), '') is null
        or normalized ->> 'unit' not in ('UN', 'KG')
        or normalized ->> 'product_type' not in ('RAW', 'FRACTIONATED')
      then
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'INCOMPLETE_PRODUCT',
          'severity', 'ERROR',
          'field', 'row',
          'problem', 'Produto possui campos obrigatórios ausentes ou inválidos.',
          'suggestedCorrection', 'Revise SKU, nome, categoria, unidade e tipo.'
        ));
      end if;
      if nullif(normalized ->> 'ean', '') is not null
        and not private.is_valid_ean(normalized ->> 'ean')
      then
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_EAN',
          'severity', 'ERROR',
          'field', 'ean',
          'problem', 'EAN/GTIN inválido.',
          'suggestedCorrection', 'Corrija ou remova o EAN.'
        ));
      end if;
      if nullif(normalized ->> 'minimum_quantity', '') is not null
        and normalized ->> 'minimum_quantity' !~ '^[0-9]{1,15}([.][0-9]{1,3})?$'
      then
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_MINIMUM_QUANTITY',
          'severity', 'ERROR',
          'field', 'minimum_quantity',
          'problem', 'Quantidade mínima inválida.',
          'suggestedCorrection', 'Informe quantidade não negativa com até três casas decimais.'
        ));
      end if;
      if nullif(normalized ->> 'opening_quantity', '') is not null
        and normalized ->> 'opening_quantity' !~ '^[0-9]{1,15}([.][0-9]{1,3})?$'
      then
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'INVALID_OPENING_QUANTITY',
          'severity', 'ERROR',
          'field', 'opening_quantity',
          'problem', 'Quantidade atual inválida.',
          'suggestedCorrection', 'Informe quantidade não negativa com até três casas decimais.'
        ));
      end if;

      if jsonb_array_length(issues) > 0 then
        state_value := 'ERROR';
        action_value := null;
      else
        select coalesce(array_agg(distinct matched.product_id), '{}'::uuid[])
        into matched_ids
        from (
          select mapping.internal_id as product_id
          from public.external_entity_mappings mapping
          where nullif(normalized ->> 'external_id', '') is not null
            and mapping.source_system = btrim(p_source_name)
            and mapping.entity_type = 'PRODUCT'
            and mapping.external_id = normalized ->> 'external_id'
          union all
          select product.id
          from public.products product
          where lower(btrim(product.sku)) = lower(btrim(normalized ->> 'sku'))
          union all
          select product.id
          from public.products product
          where nullif(normalized ->> 'ean', '') is not null
            and product.ean = normalized ->> 'ean'
        ) matched;

        if coalesce(array_length(matched_ids, 1), 0) > 1 then
          state_value := 'CONFLICT';
          action_value := 'CONFLICT';
          issues := jsonb_build_array(jsonb_build_object(
            'code', 'CONTRADICTORY_PRODUCT_IDENTIFIERS',
            'severity', 'CONFLICT',
            'field', 'row',
            'problem', 'Os identificadores seguros apontam para produtos diferentes.',
            'suggestedCorrection', 'Escolha um produto existente ou ignore a linha.'
          ));
        elsif coalesce(array_length(matched_ids, 1), 0) = 1 then
          resolved_id := matched_ids[1];
          state_value := 'VALID';
          action_value := 'UPDATE_CANDIDATE';
        else
          state_value := 'VALID';
          action_value := 'NEW';
          select coalesce(jsonb_agg(jsonb_build_object(
            'productId', product.id,
            'sku', product.sku,
            'name', product.name,
            'reason', 'SIMILAR_NAME'
          ) order by product.name), '[]'::jsonb)
          into suggestions
          from (
            select product.id, product.sku, product.name
            from public.products product
            where product.is_active
              and lower(regexp_replace(btrim(product.name), '\s+', ' ', 'g')) =
                lower(regexp_replace(btrim(normalized ->> 'name'), '\s+', ' ', 'g'))
            order by product.name
            limit 5
          ) product;
          if jsonb_array_length(suggestions) > 0 then
            state_value := 'WARNING';
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'SIMILAR_NAME_SUGGESTION',
              'severity', 'WARNING',
              'field', 'name',
              'problem', 'Há produto com nome semelhante, sem identificador inequívoco.',
              'suggestedCorrection', 'Revise a sugestão; nomes nunca geram merge automático.'
            ));
          end if;
        end if;

        if not exists (
          select 1
          from public.categories category
          where lower(btrim(category.name)) = lower(btrim(normalized ->> 'category'))
        ) then
          candidate := jsonb_build_object(
            'normalizedName', btrim(normalized ->> 'category'),
            'sourceValue', normalized ->> 'category',
            'approvedForCreation', false
          );
          if state_value = 'VALID' then state_value := 'WARNING'; end if;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'code', 'CATEGORY_CREATION_CANDIDATE',
            'severity', 'WARNING',
            'field', 'category',
            'problem', 'A categoria não existe e é candidata à criação.',
            'suggestedCorrection', 'Aprove a categoria antes de confirmar.'
          ));
        end if;
      end if;
    end if;

    insert into public.import_rows (
      import_batch_id,
      row_number,
      raw_data,
      normalized_data,
      validation_status,
      validation_errors,
      validation_state,
      dry_run_action,
      resolved_entity_id,
      validation_suggestions,
      category_candidate
    ) values (
      created_batch_id,
      row_number_value,
      coalesce(input_row -> 'rawData', '{}'::jsonb),
      normalized,
      case
        when state_value in ('VALID', 'WARNING', 'IGNORED')
          then 'VALID'::public.import_row_validation_status
        else 'INVALID'::public.import_row_validation_status
      end,
      issues,
      state_value,
      action_value,
      resolved_id,
      suggestions,
      candidate
    );
  end loop;

  update public.import_rows target
  set
    validation_state = 'CONFLICT',
    validation_status = 'INVALID',
    dry_run_action = 'CONFLICT',
    validation_errors = target.validation_errors || jsonb_build_array(jsonb_build_object(
      'code', 'DUPLICATE_IDENTIFIER_IN_FILE',
      'severity', 'CONFLICT',
      'field', 'row',
      'problem', 'SKU, EAN ou ID externo aparece mais de uma vez no arquivo.',
      'suggestedCorrection', 'Mantenha identificadores únicos ou ignore uma das linhas.'
    ))
  where target.import_batch_id = created_batch_id
    and target.validation_state <> 'IGNORED'
    and exists (
      select 1
      from public.import_rows other
      where other.import_batch_id = created_batch_id
        and other.id <> target.id
        and other.validation_state <> 'IGNORED'
        and (
          lower(target.normalized_data ->> 'sku') = lower(other.normalized_data ->> 'sku')
          or (
            nullif(target.normalized_data ->> 'ean', '') is not null
            and target.normalized_data ->> 'ean' = other.normalized_data ->> 'ean'
          )
          or (
            nullif(target.normalized_data ->> 'external_id', '') is not null
            and target.normalized_data ->> 'external_id' = other.normalized_data ->> 'external_id'
          )
        )
    );

  final_summary := private.refresh_operational_import_batch(created_batch_id);
  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    request_id,
    new_data,
    metadata
  ) values (
    actor_id,
    'PRODUCT_IMPORT_DRY_RUN_CREATED',
    'import_batch',
    created_batch_id::text,
    created_batch_id,
    final_summary,
    jsonb_build_object(
      'mode', p_mode,
      'filename', btrim(p_original_filename),
      'file_hash', btrim(p_file_hash)
    )
  );

  return query
  select created_batch_id, batch.status, final_summary
  from public.import_batches batch
  where batch.id = created_batch_id;
end;
$$;

create function public.get_product_import_preview(
  p_import_batch_id uuid,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  batch_record public.import_batches%rowtype;
  rows_json jsonb;
begin
  if not private.has_role('ADMIN') then
    raise exception using errcode = '42501', message = 'ADMIN role is required';
  end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 500 then
    raise exception using errcode = '22023', message = 'invalid pagination';
  end if;

  select *
  into batch_record
  from public.import_batches
  where id = p_import_batch_id
    and operational_import_type = 'PRODUCTS'
    and product_import_mode is not null;
  if not found then
    raise exception using errcode = 'P0002', message = 'product import batch was not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'rowNumber', row_number,
    'rawData', raw_data,
    'normalizedData', normalized_data,
    'state', validation_state,
    'action', dry_run_action,
    'issues', validation_errors,
    'resolvedEntityId', resolved_entity_id,
    'categoryCandidate', category_candidate,
    'suggestions', validation_suggestions
  ) order by row_number), '[]'::jsonb)
  into rows_json
  from (
    select *
    from public.import_rows
    where import_batch_id = p_import_batch_id
    order by row_number
    limit p_page_size
    offset (p_page - 1) * p_page_size
  ) page_rows;

  return jsonb_build_object(
    'batch_id', batch_record.id,
    'mode', batch_record.product_import_mode,
    'status', batch_record.status,
    'summary', batch_record.dry_run_summary,
    'rows', rows_json,
    'page', p_page,
    'page_size', p_page_size,
    'total_rows', batch_record.total_rows
  );
end;
$$;

revoke all on function public.stage_product_import_preview(
  public.product_import_mode,
  text,
  text,
  text,
  text,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) from public, anon;
revoke all on function public.get_product_import_preview(uuid, integer, integer)
from public, anon;

grant execute on function public.stage_product_import_preview(
  public.product_import_mode,
  text,
  text,
  text,
  text,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) to authenticated;
grant execute on function public.get_product_import_preview(uuid, integer, integer)
to authenticated;

comment on function public.stage_product_import_preview(
  public.product_import_mode,
  text,
  text,
  text,
  text,
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) is
  'Staging transacional do wizard de produtos; INITIAL_MIGRATION aceita saldo inicial e MASTER_DATA_IMPORT o proíbe.';

comment on function public.get_product_import_preview(uuid, integer, integer) is
  'Preview paginado e administrativo do wizard; não promove entidades oficiais.';

commit;
