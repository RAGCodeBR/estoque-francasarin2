begin;

create type public.operational_import_type as enum (
  'PRODUCTS',
  'CATEGORIES',
  'LOCATIONS',
  'SUPPLIERS',
  'STOCK_RECONCILIATION'
);

alter table public.import_batches
  add column operational_import_type public.operational_import_type,
  add column operational_reason text,
  add column operational_confirmation_key text,
  add constraint import_batches_operational_reason_not_blank check (
    operational_reason is null or btrim(operational_reason) <> ''
  ),
  add constraint import_batches_operational_confirmation_key_not_blank check (
    operational_confirmation_key is null or btrim(operational_confirmation_key) <> ''
  );

alter table public.import_rows
  add column operational_preview jsonb,
  add constraint import_rows_operational_preview_object check (
    operational_preview is null or jsonb_typeof(operational_preview) = 'object'
  );

create index import_batches_operational_type_status_idx
  on public.import_batches (operational_import_type, status, created_at desc)
  where operational_import_type is not null;

create unique index import_batches_operational_confirmation_key_unique
  on public.import_batches (operational_confirmation_key)
  where operational_confirmation_key is not null;

create index import_rows_operational_preview_product_idx
  on public.import_rows ((operational_preview ->> 'productId'))
  where operational_preview ? 'productId';

create function private.refresh_operational_import_batch(p_import_batch_id uuid)
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
    'POSITIVE', count(*) filter (where operational_preview ->> 'movementType' = 'ADJUSTMENT_POSITIVE')::integer,
    'NEGATIVE', count(*) filter (where operational_preview ->> 'movementType' = 'ADJUSTMENT_NEGATIVE')::integer,
    'UNCHANGED', count(*) filter (where operational_preview ->> 'movementType' is null and operational_preview ? 'difference')::integer
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

create function public.stage_operational_import_preview(
  p_import_type public.operational_import_type,
  p_source_type text,
  p_source_name text,
  p_original_filename text,
  p_file_hash text,
  p_file_size_bytes bigint,
  p_detected_headers jsonb,
  p_column_mapping jsonb,
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
  input_row jsonb;
  normalized jsonb;
  issues jsonb;
  row_number_value integer;
  state_value public.import_row_validation_state;
  action_value public.import_row_dry_run_action;
  resolved_id uuid;
  candidate jsonb;
  preview jsonb;
  matched_ids uuid[];
  product_record record;
  system_quantity numeric(18, 3);
  file_quantity numeric(18, 3);
  difference numeric(18, 3);
  final_summary jsonb;
  original_batch_id uuid;
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then
    raise exception using errcode = '42501', message = 'active ADMIN user is required';
  end if;
  if p_import_type is null or p_source_type not in ('CSV', 'XLSX')
    or nullif(btrim(p_source_name), '') is null
    or nullif(btrim(p_file_hash), '') is null
    or p_file_size_bytes is null or p_file_size_bytes <= 0
  then
    raise exception using errcode = '22023', message = 'invalid operational import metadata';
  end if;
  if jsonb_typeof(p_detected_headers) <> 'array'
    or jsonb_array_length(p_detected_headers) = 0
    or jsonb_typeof(p_column_mapping) <> 'array'
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 10000
  then
    raise exception using errcode = '22023', message = 'headers, mapping or rows are invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_column_mapping) mapping
    where not exists (
      select 1 from jsonb_array_elements_text(p_detected_headers) header
      where header = mapping ->> 'sourceColumn'
    )
  ) or exists (
    select 1 from jsonb_array_elements_text(p_detected_headers) header
    where (select count(*) from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'sourceColumn' = header) <> 1
  ) or exists (
    select mapping ->> 'targetField' from jsonb_array_elements(p_column_mapping) mapping
    where mapping ->> 'targetField' <> 'IGNORE'
    group by mapping ->> 'targetField' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'every source column must have one unique mapping decision';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_column_mapping) mapping
    where mapping ->> 'targetField' <> 'IGNORE'
      and not case p_import_type
        when 'PRODUCTS' then mapping ->> 'targetField' in ('sku', 'ean', 'name', 'category', 'product_type', 'unit', 'minimum_quantity')
        when 'CATEGORIES' then mapping ->> 'targetField' in ('name', 'description')
        when 'LOCATIONS' then mapping ->> 'targetField' in ('name', 'description', 'location_type')
        when 'SUPPLIERS' then mapping ->> 'targetField' in ('document', 'legal_name', 'trade_name')
        when 'STOCK_RECONCILIATION' then mapping ->> 'targetField' in ('sku', 'ean', 'current_quantity')
      end
  ) then
    raise exception using errcode = '22023', message = 'mapping target is not allowed for this operational import type';
  end if;
  if (p_import_type = 'PRODUCTS' and exists (
      select 1 from unnest(array['sku', 'name', 'category', 'product_type', 'unit', 'minimum_quantity']) required(target)
      where not exists (select 1 from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'targetField' = required.target)
    ))
    or (p_import_type = 'CATEGORIES' and not exists (select 1 from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'targetField' = 'name'))
    or (p_import_type = 'LOCATIONS' and exists (
      select 1 from unnest(array['name', 'location_type']) required(target)
      where not exists (select 1 from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'targetField' = required.target)
    ))
    or (p_import_type = 'SUPPLIERS' and not exists (select 1 from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'targetField' = 'legal_name'))
    or (p_import_type = 'STOCK_RECONCILIATION' and (
      not exists (select 1 from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'targetField' = 'current_quantity')
      or not exists (select 1 from jsonb_array_elements(p_column_mapping) mapping where mapping ->> 'targetField' in ('sku', 'ean'))
    ))
  then
    raise exception using errcode = '22023', message = 'required operational mapping target is missing';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_column_mapping) mapping
    where mapping ->> 'targetField' in ('opening_quantity')
       or (p_import_type <> 'STOCK_RECONCILIATION' and mapping ->> 'targetField' = 'current_quantity')
  ) then
    raise exception using errcode = '22023', message = 'stock quantity is forbidden in master-data imports';
  end if;
  if p_import_type <> 'STOCK_RECONCILIATION' and exists (
    select 1 from jsonb_array_elements(p_rows) staged
    where coalesce(staged -> 'normalizedData', '{}'::jsonb) ?| array['current_quantity', 'opening_quantity']
  ) then
    raise exception using errcode = '22023', message = 'normalized stock quantity is forbidden in master-data imports';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('operational-import:file:' || btrim(p_file_hash), 0));
  select id into original_batch_id
  from public.import_batches
  where file_hash = btrim(p_file_hash)
    and duplicate_of_batch_id is null
    and status not in ('FAILED', 'CANCELLED')
  order by created_at
  limit 1;
  if original_batch_id is not null and p_duplicate_of_batch_id is distinct from original_batch_id then
    raise exception using errcode = '23505', message = 'file already has an import batch; explicit duplicate approval is required';
  end if;
  if original_batch_id is null and p_duplicate_of_batch_id is not null then
    raise exception using errcode = '22023', message = 'duplicate batch does not match this file';
  end if;

  insert into public.import_batches (
    source_type, source_name, original_filename, file_hash, file_size_bytes, status,
    created_by, detected_headers, column_mapping, duplicate_of_batch_id,
    operational_import_type, metadata
  ) values (
    p_source_type, btrim(p_source_name), nullif(btrim(p_original_filename), ''), btrim(p_file_hash),
    p_file_size_bytes, 'VALIDATING', actor_id, p_detected_headers, p_column_mapping,
    p_duplicate_of_batch_id, p_import_type,
    jsonb_build_object('flow', 'OPERATIONAL_IMPORT', 'schema_version', 1)
  ) returning id into created_batch_id;

  for input_row in select value from jsonb_array_elements(p_rows) loop
    row_number_value := (input_row ->> 'rowNumber')::integer;
    normalized := input_row -> 'normalizedData';
    issues := coalesce(input_row -> 'validationErrors', '[]'::jsonb);
    resolved_id := null;
    candidate := null;
    preview := null;
    matched_ids := null;
    if row_number_value is null or row_number_value <= 0 or jsonb_typeof(issues) <> 'array' then
      raise exception using errcode = '22023', message = 'invalid staged row';
    end if;
    if p_import_type in ('PRODUCTS', 'STOCK_RECONCILIATION')
      and nullif(normalized ->> 'ean', '') is not null
      and not private.is_valid_ean(normalized ->> 'ean')
    then
      issues := issues || jsonb_build_array(jsonb_build_object('code', 'INVALID_EAN', 'field', 'ean', 'problem', 'EAN/GTIN inválido.'));
    end if;
    if p_import_type = 'SUPPLIERS'
      and nullif(normalized ->> 'document', '') is not null
      and not private.is_valid_cnpj(normalized ->> 'document')
    then
      issues := issues || jsonb_build_array(jsonb_build_object('code', 'INVALID_CNPJ', 'field', 'document', 'problem', 'CNPJ inválido.'));
    end if;

    if coalesce((input_row ->> 'ignored')::boolean, false) then
      state_value := 'IGNORED'; action_value := 'IGNORED';
    elsif jsonb_array_length(issues) > 0 then
      state_value := 'ERROR'; action_value := null;
    elsif normalized is null or jsonb_typeof(normalized) <> 'object' then
      state_value := 'ERROR'; action_value := null;
      issues := jsonb_build_array(jsonb_build_object('code', 'INVALID_NORMALIZED_ROW', 'field', 'row', 'problem', 'Linha normalizada inválida.'));
    elsif p_import_type = 'PRODUCTS' then
      select array_agg(distinct product.id)
      into matched_ids
      from public.products product
      where lower(btrim(product.sku)) = lower(btrim(normalized ->> 'sku'))
         or (nullif(normalized ->> 'ean', '') is not null and product.ean = normalized ->> 'ean');
      if coalesce(array_length(matched_ids, 1), 0) > 1 then
        state_value := 'CONFLICT'; action_value := 'CONFLICT';
        issues := jsonb_build_array(jsonb_build_object('code', 'AMBIGUOUS_PRODUCT', 'field', 'row', 'problem', 'SKU e EAN identificam produtos diferentes.', 'suggestedCorrection', 'Resolva para um produto ou corrija o arquivo.'));
      elsif coalesce(array_length(matched_ids, 1), 0) = 1 then
        resolved_id := matched_ids[1]; state_value := 'VALID'; action_value := 'UPDATE_CANDIDATE';
      else
        state_value := 'VALID'; action_value := 'NEW';
      end if;
      if not exists (select 1 from public.categories where lower(btrim(name)) = lower(btrim(normalized ->> 'category'))) then
        candidate := jsonb_build_object('normalizedName', btrim(normalized ->> 'category'), 'sourceValue', normalized ->> 'category', 'approvedForCreation', false);
        if state_value = 'VALID' then state_value := 'WARNING'; end if;
      end if;
    elsif p_import_type = 'CATEGORIES' then
      select array_agg(category.id) into matched_ids from public.categories category
      where lower(btrim(category.name)) = lower(btrim(normalized ->> 'name'));
      if coalesce(array_length(matched_ids, 1), 0) = 1 then resolved_id := matched_ids[1]; action_value := 'UPDATE_CANDIDATE'; else action_value := 'NEW'; end if;
      state_value := 'VALID';
    elsif p_import_type = 'LOCATIONS' then
      select array_agg(location.id) into matched_ids from public.locations location
      where lower(btrim(location.name)) = lower(btrim(normalized ->> 'name'));
      if coalesce(array_length(matched_ids, 1), 0) = 1 then resolved_id := matched_ids[1]; action_value := 'UPDATE_CANDIDATE'; else action_value := 'NEW'; end if;
      state_value := 'VALID';
    elsif p_import_type = 'SUPPLIERS' then
      select array_agg(distinct supplier.id) into matched_ids from public.suppliers supplier
      where (nullif(normalized ->> 'document', '') is not null and supplier.document = normalized ->> 'document')
         or lower(btrim(supplier.legal_name)) = lower(btrim(normalized ->> 'legal_name'));
      if coalesce(array_length(matched_ids, 1), 0) > 1 then
        state_value := 'CONFLICT'; action_value := 'CONFLICT';
        issues := jsonb_build_array(jsonb_build_object('code', 'AMBIGUOUS_SUPPLIER', 'field', 'row', 'problem', 'Documento e razão social identificam fornecedores diferentes.'));
      elsif coalesce(array_length(matched_ids, 1), 0) = 1 then
        resolved_id := matched_ids[1]; state_value := 'VALID'; action_value := 'UPDATE_CANDIDATE';
      else state_value := 'VALID'; action_value := 'NEW'; end if;
    else
      select array_agg(distinct product.id)
      into matched_ids
      from public.products product
      where (nullif(normalized ->> 'sku', '') is not null and lower(btrim(product.sku)) = lower(btrim(normalized ->> 'sku')))
         or (nullif(normalized ->> 'ean', '') is not null and product.ean = normalized ->> 'ean');
      if coalesce(array_length(matched_ids, 1), 0) <> 1 then
        state_value := 'CONFLICT'; action_value := 'CONFLICT';
        issues := jsonb_build_array(jsonb_build_object('code', 'PRODUCT_NOT_UNIQUE', 'field', 'row', 'problem', 'SKU/EAN não identifica exatamente um produto.', 'suggestedCorrection', 'Corrija o identificador ou selecione manualmente um produto.'));
      else
        resolved_id := matched_ids[1];
        select product.sku, product.name, coalesce(balance.quantity, 0)::numeric(18,3) as quantity
        into product_record
        from public.products product left join public.stock_balances balance on balance.product_id = product.id
        where product.id = resolved_id and product.is_active;
        if not found then
          state_value := 'CONFLICT'; action_value := 'CONFLICT';
          issues := jsonb_build_array(jsonb_build_object('code', 'INACTIVE_PRODUCT', 'field', 'row', 'problem', 'Produto inexistente ou inativo.'));
        else
          system_quantity := product_record.quantity;
          file_quantity := private.parse_import_quantity(normalized ->> 'current_quantity', 'current_quantity', row_number_value);
          difference := file_quantity - system_quantity;
          preview := jsonb_build_object(
            'productId', resolved_id, 'sku', product_record.sku, 'productName', product_record.name,
            'systemQuantity', to_char(system_quantity, 'FM999999999999990.000'),
            'fileQuantity', to_char(file_quantity, 'FM999999999999990.000'),
            'difference', to_char(difference, 'FM999999999999990.000'),
            'movementType', case when difference > 0 then 'ADJUSTMENT_POSITIVE' when difference < 0 then 'ADJUSTMENT_NEGATIVE' else null end
          );
          state_value := 'VALID'; action_value := 'UPDATE_CANDIDATE';
        end if;
      end if;
    end if;

    insert into public.import_rows (
      import_batch_id, row_number, raw_data, normalized_data, validation_status,
      validation_errors, validation_state, dry_run_action, resolved_entity_id,
      category_candidate, operational_preview
    ) values (
      created_batch_id, row_number_value, coalesce(input_row -> 'rawData', '{}'::jsonb), normalized,
      case when state_value in ('VALID', 'WARNING', 'IGNORED') then 'VALID'::public.import_row_validation_status else 'INVALID'::public.import_row_validation_status end,
      issues, state_value, action_value, resolved_id, candidate, preview
    );
  end loop;

  if p_import_type in ('PRODUCTS', 'STOCK_RECONCILIATION') then
    update public.import_rows target
    set validation_state = 'CONFLICT', validation_status = 'INVALID', dry_run_action = 'CONFLICT',
      validation_errors = target.validation_errors || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_IDENTIFIER_IN_FILE', 'field', 'row', 'problem', 'SKU ou EAN repetido no arquivo.'))
    where target.import_batch_id = created_batch_id and target.validation_state <> 'IGNORED'
      and exists (
        select 1 from public.import_rows other
        where other.import_batch_id = created_batch_id and other.id <> target.id and other.validation_state <> 'IGNORED'
          and (
            (nullif(target.normalized_data ->> 'sku', '') is not null and lower(target.normalized_data ->> 'sku') = lower(other.normalized_data ->> 'sku'))
            or (nullif(target.normalized_data ->> 'ean', '') is not null and target.normalized_data ->> 'ean' = other.normalized_data ->> 'ean')
          )
      );
  elsif p_import_type in ('CATEGORIES', 'LOCATIONS', 'SUPPLIERS') then
    update public.import_rows target
    set validation_state = 'CONFLICT', validation_status = 'INVALID', dry_run_action = 'CONFLICT',
      validation_errors = target.validation_errors || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_MASTER_DATA_IN_FILE', 'field', 'row', 'problem', 'Registro mestre repetido no arquivo.'))
    where target.import_batch_id = created_batch_id and target.validation_state <> 'IGNORED'
      and exists (
        select 1 from public.import_rows other
        where other.import_batch_id = created_batch_id and other.id <> target.id and other.validation_state <> 'IGNORED'
          and case p_import_type
            when 'CATEGORIES' then lower(btrim(target.normalized_data ->> 'name')) = lower(btrim(other.normalized_data ->> 'name'))
            when 'LOCATIONS' then lower(btrim(target.normalized_data ->> 'name')) = lower(btrim(other.normalized_data ->> 'name'))
            when 'SUPPLIERS' then
              (nullif(target.normalized_data ->> 'document', '') is not null and target.normalized_data ->> 'document' = other.normalized_data ->> 'document')
              or lower(btrim(target.normalized_data ->> 'legal_name')) = lower(btrim(other.normalized_data ->> 'legal_name'))
          end
      );
  end if;

  final_summary := private.refresh_operational_import_batch(created_batch_id);
  return query select created_batch_id, batch.status, final_summary
  from public.import_batches batch where batch.id = created_batch_id;
end;
$$;

create function public.get_operational_import_preview(
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
  if not private.has_role('ADMIN') then raise exception using errcode = '42501', message = 'ADMIN role is required'; end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 500 then raise exception using errcode = '22023', message = 'invalid pagination'; end if;
  select * into batch_record from public.import_batches where id = p_import_batch_id and operational_import_type is not null;
  if not found then raise exception using errcode = 'P0002', message = 'operational import batch was not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'rowNumber', row_number, 'rawData', raw_data, 'normalizedData', normalized_data,
    'state', validation_state, 'action', dry_run_action, 'issues', validation_errors,
    'resolvedEntityId', resolved_entity_id, 'comparison', operational_preview
  ) order by row_number), '[]'::jsonb)
  into rows_json from (
    select * from public.import_rows where import_batch_id = p_import_batch_id
    order by row_number limit p_page_size offset (p_page - 1) * p_page_size
  ) page_rows;
  return jsonb_build_object(
    'batch_id', batch_record.id, 'import_type', batch_record.operational_import_type,
    'status', batch_record.status, 'summary', batch_record.dry_run_summary,
    'rows', rows_json, 'page', p_page, 'page_size', p_page_size, 'total_rows', batch_record.total_rows
  );
end;
$$;

create function public.resolve_operational_import(
  p_import_batch_id uuid,
  p_resolutions jsonb default '[]'::jsonb,
  p_approved_categories jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  batch_record public.import_batches%rowtype;
  resolution jsonb;
  target_row public.import_rows%rowtype;
  entity_id_value uuid;
  final_summary jsonb;
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then raise exception using errcode = '42501', message = 'active ADMIN user is required'; end if;
  if jsonb_typeof(p_resolutions) <> 'array' or jsonb_typeof(p_approved_categories) <> 'array' then raise exception using errcode = '22023', message = 'resolutions must be arrays'; end if;
  perform pg_advisory_xact_lock(hashtextextended('operational-import-batch:' || p_import_batch_id::text, 0));
  select * into batch_record from public.import_batches where id = p_import_batch_id for update;
  if not found or batch_record.operational_import_type is null then raise exception using errcode = 'P0002', message = 'operational import batch was not found'; end if;
  if batch_record.status not in ('PENDING_MAPPING', 'READY') then raise exception using errcode = '22023', message = 'batch cannot be resolved in its current state'; end if;
  for resolution in select value from jsonb_array_elements(p_resolutions) loop
    select * into target_row from public.import_rows where import_batch_id = p_import_batch_id and row_number = (resolution ->> 'rowNumber')::integer for update;
    if not found or target_row.validation_state <> 'CONFLICT' then raise exception using errcode = '22023', message = 'resolution only accepts conflict rows'; end if;
    if resolution ->> 'decision' = 'IGNORE' then
      update public.import_rows set validation_state = 'IGNORED', validation_status = 'VALID', dry_run_action = 'IGNORED', validation_errors = '[]'::jsonb, resolved_entity_id = null, operational_preview = null where id = target_row.id;
    elsif resolution ->> 'decision' = 'USE_EXISTING' then
      entity_id_value := (resolution ->> 'entityId')::uuid;
      if batch_record.operational_import_type in ('PRODUCTS', 'STOCK_RECONCILIATION') and not exists (select 1 from public.products where id = entity_id_value and is_active) then raise exception using errcode = '22023', message = 'selected product is invalid';
      elsif batch_record.operational_import_type = 'CATEGORIES' and not exists (select 1 from public.categories where id = entity_id_value) then raise exception using errcode = '22023', message = 'selected category is invalid';
      elsif batch_record.operational_import_type = 'LOCATIONS' and not exists (select 1 from public.locations where id = entity_id_value) then raise exception using errcode = '22023', message = 'selected location is invalid';
      elsif batch_record.operational_import_type = 'SUPPLIERS' and not exists (select 1 from public.suppliers where id = entity_id_value) then raise exception using errcode = '22023', message = 'selected supplier is invalid';
      end if;
      update public.import_rows set validation_state = 'WARNING', validation_status = 'VALID', dry_run_action = 'UPDATE_CANDIDATE', validation_errors = '[]'::jsonb, resolved_entity_id = entity_id_value where id = target_row.id;
      if batch_record.operational_import_type = 'STOCK_RECONCILIATION' then
        update public.import_rows row set operational_preview = (
          select jsonb_build_object(
            'productId', product.id, 'sku', product.sku, 'productName', product.name,
            'systemQuantity', to_char(coalesce(balance.quantity, 0), 'FM999999999999990.000'),
            'fileQuantity', row.normalized_data ->> 'current_quantity',
            'difference', to_char((row.normalized_data ->> 'current_quantity')::numeric - coalesce(balance.quantity, 0), 'FM999999999999990.000'),
            'movementType', case when (row.normalized_data ->> 'current_quantity')::numeric > coalesce(balance.quantity, 0) then 'ADJUSTMENT_POSITIVE' when (row.normalized_data ->> 'current_quantity')::numeric < coalesce(balance.quantity, 0) then 'ADJUSTMENT_NEGATIVE' else null end
          ) from public.products product left join public.stock_balances balance on balance.product_id = product.id where product.id = entity_id_value
        ) where row.id = target_row.id;
      end if;
    else raise exception using errcode = '22023', message = 'unsupported conflict resolution'; end if;
  end loop;
  update public.import_rows row set
    category_candidate = jsonb_set(row.category_candidate, '{approvedForCreation}', 'true'::jsonb),
    validation_state = case when row.validation_state = 'WARNING' then 'VALID'::public.import_row_validation_state else row.validation_state end
  where row.import_batch_id = p_import_batch_id and row.category_candidate is not null
    and exists (select 1 from jsonb_array_elements_text(p_approved_categories) approved where lower(btrim(approved)) = lower(btrim(row.category_candidate ->> 'normalizedName')));
  update public.import_batches set approved_category_creations = p_approved_categories where id = p_import_batch_id;
  if batch_record.operational_import_type in ('PRODUCTS', 'STOCK_RECONCILIATION') then
    update public.import_rows target
    set validation_state = 'CONFLICT', validation_status = 'INVALID', dry_run_action = 'CONFLICT',
      validation_errors = target.validation_errors || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_RESOLVED_PRODUCT', 'field', 'row', 'problem', 'Mais de uma linha foi associada ao mesmo produto.'))
    where target.import_batch_id = p_import_batch_id and target.validation_state <> 'IGNORED'
      and target.resolved_entity_id is not null
      and exists (
        select 1 from public.import_rows previous
        where previous.import_batch_id = p_import_batch_id and previous.validation_state <> 'IGNORED'
          and previous.resolved_entity_id = target.resolved_entity_id and previous.row_number < target.row_number
      );
  end if;
  final_summary := private.refresh_operational_import_batch(p_import_batch_id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, request_id, new_data)
  values (actor_id, 'OPERATIONAL_IMPORT_RESOLVED', 'import_batch', p_import_batch_id::text, p_import_batch_id, final_summary);
  return jsonb_build_object('summary', final_summary);
end;
$$;

create function public.confirm_operational_product_import(
  p_import_batch_id uuid,
  p_update_existing boolean,
  p_idempotency_key text
)
returns table (
  batch_id uuid, import_type public.operational_import_type, applied boolean,
  created integer, associated integer, updated integer, movements_created integer,
  unchanged integer, ignored integer, warnings integer, errors integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  batch_record public.import_batches%rowtype;
  legacy record;
begin
  if not private.has_role('ADMIN') then raise exception using errcode = '42501', message = 'ADMIN role is required'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'idempotency_key is required'; end if;
  select * into batch_record from public.import_batches where id = p_import_batch_id for update;
  if not found or batch_record.operational_import_type <> 'PRODUCTS' then raise exception using errcode = '22023', message = 'batch is not a PRODUCTS operational import'; end if;
  if batch_record.status = 'COMPLETED' then
    if batch_record.operational_confirmation_key is distinct from btrim(p_idempotency_key) then raise exception using errcode = '22000', message = 'batch was confirmed with another idempotency key'; end if;
    return query select p_import_batch_id, 'PRODUCTS'::public.operational_import_type, false,
      coalesce((batch_record.confirmation_report ->> 'products_created')::integer, 0),
      coalesce((batch_record.confirmation_report ->> 'products_associated')::integer, 0),
      coalesce((batch_record.confirmation_report ->> 'products_updated')::integer, 0), 0, 0,
      coalesce((batch_record.confirmation_report ->> 'lines_ignored')::integer, 0),
      coalesce((batch_record.confirmation_report ->> 'warnings')::integer, 0), 0;
    return;
  end if;
  update public.import_batches set operational_confirmation_key = btrim(p_idempotency_key) where id = p_import_batch_id;
  select * into legacy from public.confirm_product_import(
    p_import_batch_id, 'MASTER_DATA_IMPORT',
    case when p_update_existing then 'UPDATE_MASTER_DATA'::public.existing_product_import_strategy else 'ASSOCIATE_ONLY'::public.existing_product_import_strategy end,
    null, null
  );
  return query select p_import_batch_id, 'PRODUCTS'::public.operational_import_type, legacy.applied,
    legacy.products_created, legacy.products_associated, legacy.products_updated, 0, 0,
    legacy.lines_ignored, legacy.warnings, legacy.errors;
end;
$$;

create function public.confirm_operational_master_data_import(
  p_import_batch_id uuid,
  p_update_existing boolean,
  p_idempotency_key text
)
returns table (
  batch_id uuid, import_type public.operational_import_type, applied boolean,
  created integer, associated integer, updated integer, movements_created integer,
  unchanged integer, ignored integer, warnings integer, errors integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  batch_record public.import_batches%rowtype;
  row_record public.import_rows%rowtype;
  entity_id_value uuid;
  created_count integer := 0;
  associated_count integer := 0;
  updated_count integer := 0;
  ignored_count integer := 0;
  warning_count integer := 0;
  report jsonb;
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then raise exception using errcode = '42501', message = 'active ADMIN user is required'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'idempotency_key is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('operational-import-confirm:' || p_import_batch_id::text, 0));
  select * into batch_record from public.import_batches where id = p_import_batch_id for update;
  if not found or batch_record.operational_import_type not in ('CATEGORIES', 'LOCATIONS', 'SUPPLIERS') then raise exception using errcode = '22023', message = 'batch is not a supported master-data import'; end if;
  if batch_record.status = 'COMPLETED' then
    if batch_record.operational_confirmation_key is distinct from btrim(p_idempotency_key) then raise exception using errcode = '22000', message = 'batch was confirmed with another idempotency key'; end if;
    return query select p_import_batch_id, batch_record.operational_import_type, false,
      (batch_record.confirmation_report ->> 'created')::integer, (batch_record.confirmation_report ->> 'associated')::integer,
      (batch_record.confirmation_report ->> 'updated')::integer, 0, 0,
      (batch_record.confirmation_report ->> 'ignored')::integer, (batch_record.confirmation_report ->> 'warnings')::integer, 0;
    return;
  end if;
  if batch_record.status <> 'READY' or exists (select 1 from public.import_rows where import_batch_id = p_import_batch_id and (validation_state is null or validation_state in ('ERROR', 'CONFLICT'))) then raise exception using errcode = '22023', message = 'batch has unresolved rows'; end if;
  update public.import_batches set status = 'IMPORTING', operational_confirmation_key = btrim(p_idempotency_key), confirmation_started_at = statement_timestamp() where id = p_import_batch_id;
  for row_record in select * from public.import_rows where import_batch_id = p_import_batch_id order by row_number for update loop
    if row_record.validation_state = 'IGNORED' then ignored_count := ignored_count + 1; continue; end if;
    if row_record.validation_state = 'WARNING' then warning_count := warning_count + 1; end if;
    entity_id_value := row_record.resolved_entity_id;
    if batch_record.operational_import_type = 'CATEGORIES' then
      if entity_id_value is null then
        insert into public.categories (name, description, created_by, updated_by) values (row_record.normalized_data ->> 'name', nullif(row_record.normalized_data ->> 'description', ''), actor_id, actor_id) returning id into entity_id_value;
        created_count := created_count + 1;
      elsif p_update_existing then
        update public.categories set name = row_record.normalized_data ->> 'name', description = nullif(row_record.normalized_data ->> 'description', ''), updated_at = statement_timestamp(), updated_by = actor_id where id = entity_id_value;
        updated_count := updated_count + 1;
      else associated_count := associated_count + 1; end if;
    elsif batch_record.operational_import_type = 'LOCATIONS' then
      if entity_id_value is null then
        insert into public.locations (name, description, location_type, created_by, updated_by) values (row_record.normalized_data ->> 'name', nullif(row_record.normalized_data ->> 'description', ''), (row_record.normalized_data ->> 'location_type')::public.location_type, actor_id, actor_id) returning id into entity_id_value;
        created_count := created_count + 1;
      elsif p_update_existing then
        update public.locations set name = row_record.normalized_data ->> 'name', description = nullif(row_record.normalized_data ->> 'description', ''), location_type = (row_record.normalized_data ->> 'location_type')::public.location_type, updated_at = statement_timestamp(), updated_by = actor_id where id = entity_id_value;
        updated_count := updated_count + 1;
      else associated_count := associated_count + 1; end if;
    else
      if entity_id_value is null then
        insert into public.suppliers (legal_name, trade_name, document) values (row_record.normalized_data ->> 'legal_name', nullif(row_record.normalized_data ->> 'trade_name', ''), nullif(row_record.normalized_data ->> 'document', '')) returning id into entity_id_value;
        created_count := created_count + 1;
      elsif p_update_existing then
        update public.suppliers set legal_name = row_record.normalized_data ->> 'legal_name', trade_name = nullif(row_record.normalized_data ->> 'trade_name', ''), document = nullif(row_record.normalized_data ->> 'document', ''), updated_at = statement_timestamp() where id = entity_id_value;
        updated_count := updated_count + 1;
      else associated_count := associated_count + 1; end if;
    end if;
    update public.import_rows set resolved_entity_id = entity_id_value,
      promotion_action = case when row_record.resolved_entity_id is null then 'CREATED'::public.import_row_promotion_action when p_update_existing then 'UPDATED'::public.import_row_promotion_action else 'ASSOCIATED'::public.import_row_promotion_action end,
      promoted_at = statement_timestamp(), promotion_metadata = jsonb_build_object('flow', 'OPERATIONAL_IMPORT') where id = row_record.id;
  end loop;
  report := jsonb_build_object('created', created_count, 'associated', associated_count, 'updated', updated_count, 'movements_created', 0, 'unchanged', 0, 'ignored', ignored_count, 'warnings', warning_count, 'errors', 0);
  update public.import_batches set status = 'COMPLETED', confirmed_at = statement_timestamp(), confirmed_by = actor_id, confirmation_report = report where id = p_import_batch_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, request_id, new_data, metadata) values (actor_id, 'OPERATIONAL_IMPORT_COMPLETED', 'import_batch', p_import_batch_id::text, p_import_batch_id, report, jsonb_build_object('import_type', batch_record.operational_import_type, 'file_hash', batch_record.file_hash, 'filename', batch_record.original_filename));
  return query select p_import_batch_id, batch_record.operational_import_type, true, created_count, associated_count, updated_count, 0, 0, ignored_count, warning_count, 0;
end;
$$;

create function public.confirm_stock_reconciliation_import(
  p_import_batch_id uuid,
  p_stock_location_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns table (
  batch_id uuid, import_type public.operational_import_type, applied boolean,
  created integer, associated integer, updated integer, movements_created integer,
  unchanged integer, ignored integer, warnings integer, errors integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  batch_record public.import_batches%rowtype;
  row_record public.import_rows%rowtype;
  actual_quantity numeric(18,3);
  file_quantity numeric(18,3);
  preview_quantity numeric(18,3);
  difference numeric(18,3);
  movement_result record;
  movement_count integer := 0;
  unchanged_count integer := 0;
  ignored_count integer := 0;
  warning_count integer := 0;
  report jsonb;
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then raise exception using errcode = '42501', message = 'active ADMIN user is required'; end if;
  if btrim(coalesce(p_reason, '')) <> 'Reconciliação via importação' then raise exception using errcode = '22023', message = 'reason must be Reconciliação via importação'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception using errcode = '22023', message = 'idempotency_key is required'; end if;
  perform private.assert_active_location(p_stock_location_id, 'STOCK', 'stock_location_id');
  perform pg_advisory_xact_lock(hashtextextended('operational-import-confirm:' || p_import_batch_id::text, 0));
  select * into batch_record from public.import_batches where id = p_import_batch_id for update;
  if not found or batch_record.operational_import_type <> 'STOCK_RECONCILIATION' then raise exception using errcode = '22023', message = 'batch is not a stock reconciliation'; end if;
  if batch_record.status = 'COMPLETED' then
    if batch_record.operational_confirmation_key is distinct from btrim(p_idempotency_key) or batch_record.stock_location_id is distinct from p_stock_location_id then raise exception using errcode = '22000', message = 'batch was confirmed with different options'; end if;
    return query select p_import_batch_id, 'STOCK_RECONCILIATION'::public.operational_import_type, false, 0, 0, 0,
      (batch_record.confirmation_report ->> 'movements_created')::integer, (batch_record.confirmation_report ->> 'unchanged')::integer,
      (batch_record.confirmation_report ->> 'ignored')::integer, (batch_record.confirmation_report ->> 'warnings')::integer, 0;
    return;
  end if;
  if batch_record.status <> 'READY' or exists (select 1 from public.import_rows where import_batch_id = p_import_batch_id and (validation_state is null or validation_state in ('ERROR', 'CONFLICT'))) then raise exception using errcode = '22023', message = 'batch has unresolved rows'; end if;

  for row_record in select * from public.import_rows where import_batch_id = p_import_batch_id and validation_state <> 'IGNORED' order by resolved_entity_id loop
    perform pg_advisory_xact_lock(hashtextextended('stock:product:' || row_record.resolved_entity_id::text, 0));
  end loop;
  for row_record in select * from public.import_rows where import_batch_id = p_import_batch_id and validation_state <> 'IGNORED' order by row_number loop
    select coalesce(balance.quantity, 0) into actual_quantity from (select 1) singleton left join public.stock_balances balance on balance.product_id = row_record.resolved_entity_id;
    preview_quantity := (row_record.operational_preview ->> 'systemQuantity')::numeric(18,3);
    if actual_quantity is distinct from preview_quantity then raise exception using errcode = '40001', message = format('stock changed after preview at row %s; run a new dry-run', row_record.row_number); end if;
  end loop;

  update public.import_batches set status = 'IMPORTING', operational_reason = btrim(p_reason), operational_confirmation_key = btrim(p_idempotency_key), stock_location_id = p_stock_location_id, confirmation_started_at = statement_timestamp() where id = p_import_batch_id;
  for row_record in select * from public.import_rows where import_batch_id = p_import_batch_id order by row_number for update loop
    if row_record.validation_state = 'IGNORED' then ignored_count := ignored_count + 1; continue; end if;
    if row_record.validation_state = 'WARNING' then warning_count := warning_count + 1; end if;
    actual_quantity := (row_record.operational_preview ->> 'systemQuantity')::numeric(18,3);
    file_quantity := private.parse_import_quantity(row_record.normalized_data ->> 'current_quantity', 'current_quantity', row_record.row_number);
    difference := file_quantity - actual_quantity;
    if difference = 0 then
      unchanged_count := unchanged_count + 1;
      update public.import_rows set promotion_action = 'ASSOCIATED', promoted_at = statement_timestamp(), promotion_metadata = jsonb_build_object('flow', 'STOCK_RECONCILIATION', 'difference', '0.000') where id = row_record.id;
    else
      select * into movement_result from private.execute_stock_movement(
        'stock_reconciliation_import', row_record.resolved_entity_id,
        case when difference > 0 then 'ADJUSTMENT_POSITIVE'::public.movement_type else 'ADJUSTMENT_NEGATIVE'::public.movement_type end,
        abs(difference), difference,
        case when difference < 0 then p_stock_location_id else null end,
        case when difference > 0 then p_stock_location_id else null end,
        null, p_import_batch_id, null, btrim(p_reason),
        'operational-reconciliation:' || p_import_batch_id::text || ':row:' || row_record.row_number::text,
        true
      );
      if movement_result.applied then movement_count := movement_count + 1; end if;
      update public.import_rows set promotion_action = 'UPDATED', promoted_at = statement_timestamp(), promotion_metadata = jsonb_build_object('flow', 'STOCK_RECONCILIATION', 'movement_id', movement_result.movement_id, 'difference', to_char(difference, 'FM999999999999990.000')) where id = row_record.id;
    end if;
  end loop;
  report := jsonb_build_object('created', 0, 'associated', 0, 'updated', 0, 'movements_created', movement_count, 'unchanged', unchanged_count, 'ignored', ignored_count, 'warnings', warning_count, 'errors', 0, 'reason', btrim(p_reason));
  update public.import_batches set status = 'COMPLETED', confirmed_at = statement_timestamp(), confirmed_by = actor_id, confirmation_report = report where id = p_import_batch_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, request_id, new_data, metadata) values (actor_id, 'STOCK_RECONCILIATION_IMPORT_COMPLETED', 'import_batch', p_import_batch_id::text, p_import_batch_id, report, jsonb_build_object('file_hash', batch_record.file_hash, 'filename', batch_record.original_filename, 'stock_location_id', p_stock_location_id));
  return query select p_import_batch_id, 'STOCK_RECONCILIATION'::public.operational_import_type, true, 0, 0, 0, movement_count, unchanged_count, ignored_count, warning_count, 0;
end;
$$;

revoke all on function private.refresh_operational_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.stage_operational_import_preview(public.operational_import_type, text, text, text, text, bigint, jsonb, jsonb, jsonb, uuid) from public, anon;
revoke all on function public.get_operational_import_preview(uuid, integer, integer) from public, anon;
revoke all on function public.resolve_operational_import(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.confirm_operational_product_import(uuid, boolean, text) from public, anon;
revoke all on function public.confirm_operational_master_data_import(uuid, boolean, text) from public, anon;
revoke all on function public.confirm_stock_reconciliation_import(uuid, uuid, text, text) from public, anon;
grant execute on function public.stage_operational_import_preview(public.operational_import_type, text, text, text, text, bigint, jsonb, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.get_operational_import_preview(uuid, integer, integer) to authenticated;
grant execute on function public.resolve_operational_import(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.confirm_operational_product_import(uuid, boolean, text) to authenticated;
grant execute on function public.confirm_operational_master_data_import(uuid, boolean, text) to authenticated;
grant execute on function public.confirm_stock_reconciliation_import(uuid, uuid, text, text) to authenticated;

comment on column public.import_batches.operational_import_type is 'Fluxo operacional futuro, explicitamente separado de INITIAL_MIGRATION.';
comment on column public.import_rows.operational_preview is 'Snapshot do preview operacional; reconciliações guardam saldo, quantidade do arquivo e diferença.';
comment on function public.confirm_stock_reconciliation_import(uuid, uuid, text, text) is 'Confirma reconciliação administrativa pelo motor transacional; nunca atualiza stock_balances diretamente.';

commit;
