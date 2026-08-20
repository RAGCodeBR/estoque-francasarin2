begin;

create type public.product_import_mode as enum (
  'INITIAL_MIGRATION',
  'MASTER_DATA_IMPORT'
);

create type public.existing_product_import_strategy as enum (
  'ASSOCIATE_ONLY',
  'UPDATE_MASTER_DATA'
);

create type public.master_quantity_import_strategy as enum (
  'IGNORE_EXTERNAL_QUANTITY',
  'RECONCILE_TO_EXTERNAL_QUANTITY'
);

create type public.import_row_promotion_action as enum (
  'CREATED',
  'ASSOCIATED',
  'UPDATED',
  'IGNORED'
);

alter table public.import_batches
  add column product_import_mode public.product_import_mode,
  add column existing_product_strategy public.existing_product_import_strategy,
  add column master_quantity_strategy public.master_quantity_import_strategy,
  add column stock_location_id uuid references public.locations (id) on delete restrict,
  add column confirmation_started_at timestamptz,
  add column confirmation_report jsonb,
  add constraint import_batches_confirmation_report_object check (
    confirmation_report is null or jsonb_typeof(confirmation_report) = 'object'
  );

alter table public.import_rows
  add column promotion_action public.import_row_promotion_action,
  add column promoted_at timestamptz,
  add column promotion_metadata jsonb not null default '{}'::jsonb,
  add constraint import_rows_promotion_metadata_object check (
    jsonb_typeof(promotion_metadata) = 'object'
  ),
  add constraint import_rows_promotion_state_consistent check (
    (promotion_action is null and promoted_at is null)
    or (promotion_action is not null and promoted_at is not null)
  );

create index import_batches_product_import_mode_idx
  on public.import_batches (product_import_mode)
  where product_import_mode is not null;

create index import_rows_promotion_action_idx
  on public.import_rows (promotion_action)
  where promotion_action is not null;

create function private.parse_import_quantity(
  quantity_text text,
  field_name text,
  row_number integer
)
returns numeric(18, 3)
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
  if quantity_text is null then
    return null;
  end if;

  if quantity_text !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' then
    raise exception using
      errcode = '22023',
      message = format(
        'row %s has invalid normalized %s; expected nonnegative NUMERIC(18,3)',
        row_number,
        field_name
      );
  end if;

  return quantity_text::numeric(18, 3);
end;
$$;

create function private.is_valid_ean(ean text)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  digit_sum integer := 0;
  position integer;
  body_length integer;
  expected_digit integer;
begin
  if ean is null then
    return true;
  end if;
  if ean !~ '^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' then
    return false;
  end if;

  body_length := length(ean) - 1;
  for position in 1..body_length loop
    digit_sum := digit_sum
      + substring(ean from position for 1)::integer
        * case when mod(body_length - position, 2) = 0 then 3 else 1 end;
  end loop;
  expected_digit := mod(10 - mod(digit_sum, 10), 10);
  return expected_digit = right(ean, 1)::integer;
end;
$$;

create function public.confirm_product_import(
  p_import_batch_id uuid,
  p_mode public.product_import_mode,
  p_existing_product_strategy public.existing_product_import_strategy,
  p_stock_location_id uuid default null,
  p_master_quantity_strategy public.master_quantity_import_strategy default null
)
returns table (
  batch_id uuid,
  import_mode public.product_import_mode,
  applied boolean,
  products_created integer,
  products_associated integer,
  products_updated integer,
  categories_created integer,
  movements_created integer,
  lines_ignored integer,
  external_quantities_ignored integer,
  warnings integer,
  errors integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_id uuid := (select auth.uid());
  batch_record public.import_batches%rowtype;
  staged_row record;
  category_record public.categories%rowtype;
  product_record public.products%rowtype;
  old_product_data jsonb;
  product_id_value uuid;
  matched_product_ids uuid[];
  parsed_minimum numeric(18, 3);
  parsed_external_quantity numeric(18, 3);
  current_quantity numeric(18, 3);
  quantity_delta numeric(18, 3);
  ean_value text;
  external_id_value text;
  promotion_value public.import_row_promotion_action;
  stock_result record;
  mapping_id uuid;
  existing_mapping_id uuid;
  existing_mapping_internal_id uuid;
  actual_rows integer;
  unclassified_rows integer;
  blocking_rows integer;
  inconsistent_rows integer;
  warning_count integer := 0;
  products_created_count integer := 0;
  products_associated_count integer := 0;
  products_updated_count integer := 0;
  categories_created_count integer := 0;
  movements_created_count integer := 0;
  lines_ignored_count integer := 0;
  external_quantities_ignored_count integer := 0;
  quantity_was_supplied boolean := false;
  product_was_updated boolean;
  final_report jsonb;
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then
    raise exception using errcode = '42501', message = 'active ADMIN user is required';
  end if;
  if p_import_batch_id is null or p_mode is null or p_existing_product_strategy is null then
    raise exception using
      errcode = '22023',
      message = 'import_batch_id, mode and existing product strategy are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product-import-confirmation', 0));
  perform pg_advisory_xact_lock(
    hashtextextended('product-import-batch:' || p_import_batch_id::text, 0)
  );

  select batch.*
  into batch_record
  from public.import_batches batch
  where batch.id = p_import_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'import batch was not found';
  end if;

  if batch_record.status = 'COMPLETED' then
    if batch_record.product_import_mode is distinct from p_mode
      or batch_record.existing_product_strategy is distinct from p_existing_product_strategy
      or batch_record.stock_location_id is distinct from p_stock_location_id
      or batch_record.master_quantity_strategy is distinct from p_master_quantity_strategy
      or batch_record.confirmation_report is null
    then
      raise exception using
        errcode = '22000',
        message = 'completed batch was confirmed with different options';
    end if;

    return query select
      p_import_batch_id,
      p_mode,
      false,
      (batch_record.confirmation_report ->> 'products_created')::integer,
      (batch_record.confirmation_report ->> 'products_associated')::integer,
      (batch_record.confirmation_report ->> 'products_updated')::integer,
      (batch_record.confirmation_report ->> 'categories_created')::integer,
      (batch_record.confirmation_report ->> 'movements_created')::integer,
      (batch_record.confirmation_report ->> 'lines_ignored')::integer,
      (batch_record.confirmation_report ->> 'external_quantities_ignored')::integer,
      (batch_record.confirmation_report ->> 'warnings')::integer,
      (batch_record.confirmation_report ->> 'errors')::integer;
    return;
  end if;

  if batch_record.status <> 'READY' then
    raise exception using
      errcode = '55000',
      message = format('import batch must be READY, current status is %s', batch_record.status::text);
  end if;

  select
    count(*)::integer,
    count(*) filter (where row.validation_state is null)::integer,
    count(*) filter (where row.validation_state in ('ERROR', 'CONFLICT'))::integer,
    count(*) filter (
      where (row.validation_state = 'IGNORED' and row.dry_run_action is distinct from 'IGNORED')
        or (
          row.validation_state in ('VALID', 'WARNING')
          and row.dry_run_action not in ('NEW', 'UPDATE_CANDIDATE')
        )
    )::integer,
    count(*) filter (where row.validation_state = 'WARNING')::integer
  into actual_rows, unclassified_rows, blocking_rows, inconsistent_rows, warning_count
  from public.import_rows row
  where row.import_batch_id = p_import_batch_id;

  if actual_rows = 0 or actual_rows <> batch_record.total_rows then
    raise exception using
      errcode = '22000',
      message = 'staging row count does not match import batch total_rows';
  end if;
  if unclassified_rows > 0 then
    raise exception using errcode = '22000', message = 'all import rows must be classified';
  end if;
  if blocking_rows > 0 then
    raise exception using
      errcode = '22000',
      message = 'import contains unresolved errors or critical conflicts';
  end if;
  if inconsistent_rows > 0 then
    raise exception using
      errcode = '22000',
      message = 'row validation state and dry-run action are inconsistent';
  end if;
  if exists (
    select 1
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
      and row.dry_run_action <> 'IGNORED'
      and row.normalized_data is null
  ) then
    raise exception using errcode = '22000', message = 'actionable rows require normalized_data';
  end if;
  if exists (
    select 1
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
      and row.dry_run_action <> 'IGNORED'
      and row.category_candidate is not null
      and (
        coalesce((row.category_candidate ->> 'approvedForCreation')::boolean, false) is not true
        or not exists (
          select 1
          from jsonb_array_elements_text(batch_record.approved_category_creations) approved(name)
          where lower(btrim(approved.name)) = lower(btrim(row.normalized_data ->> 'category'))
        )
      )
  ) then
    raise exception using
      errcode = '22000',
      message = 'all category candidates must be explicitly approved';
  end if;

  if exists (
    select 1
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
      and row.dry_run_action <> 'IGNORED'
    group by lower(btrim(row.normalized_data ->> 'sku'))
    having count(*) > 1
  ) then
    raise exception using errcode = '22000', message = 'duplicate SKU remains in staged rows';
  end if;
  if exists (
    select 1
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
      and row.dry_run_action <> 'IGNORED'
      and nullif(btrim(row.normalized_data ->> 'ean'), '') is not null
    group by row.normalized_data ->> 'ean'
    having count(*) > 1
  ) then
    raise exception using errcode = '22000', message = 'duplicate EAN remains in staged rows';
  end if;
  if exists (
    select 1
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
      and row.dry_run_action <> 'IGNORED'
      and nullif(btrim(row.normalized_data ->> 'external_id'), '') is not null
    group by row.normalized_data ->> 'external_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22000', message = 'duplicate external ID remains in staged rows';
  end if;
  if exists (
    select 1
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
      and row.dry_run_action = 'UPDATE_CANDIDATE'
      and row.resolved_entity_id is not null
    group by row.resolved_entity_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22000',
      message = 'more than one staged row resolves to the same product';
  end if;

  select
    exists (
      select 1
      from jsonb_array_elements(coalesce(batch_record.column_mapping, '[]'::jsonb)) mapping
      where mapping ->> 'targetField' = 'opening_quantity'
    )
    or exists (
      select 1
      from public.import_rows row
      where row.import_batch_id = p_import_batch_id
        and row.dry_run_action <> 'IGNORED'
        and row.normalized_data ->> 'opening_quantity' is not null
    )
  into quantity_was_supplied;

  if p_mode = 'INITIAL_MIGRATION' then
    if p_master_quantity_strategy is not null then
      raise exception using
        errcode = '22023',
        message = 'master quantity strategy is not valid for INITIAL_MIGRATION';
    end if;
    if quantity_was_supplied and p_stock_location_id is null then
      raise exception using
        errcode = '22023',
        message = 'stock location is required when initial quantities are supplied';
    end if;
  else
    if quantity_was_supplied and p_master_quantity_strategy is null then
      raise exception using
        errcode = '22023',
        message = 'MASTER_DATA_IMPORT requires an explicit external quantity strategy';
    end if;
    if not quantity_was_supplied and p_master_quantity_strategy is not null then
      raise exception using
        errcode = '22023',
        message = 'external quantity strategy was provided but no quantity column exists';
    end if;
    if p_master_quantity_strategy = 'RECONCILE_TO_EXTERNAL_QUANTITY'
      and p_stock_location_id is null
    then
      raise exception using
        errcode = '22023',
        message = 'stock location is required for quantity reconciliation';
    end if;
  end if;

  if p_stock_location_id is not null then
    perform private.assert_active_location(p_stock_location_id, 'STOCK', 'stock_location_id');
  end if;

  update public.import_batches
  set
    status = 'IMPORTING',
    product_import_mode = p_mode,
    existing_product_strategy = p_existing_product_strategy,
    master_quantity_strategy = p_master_quantity_strategy,
    stock_location_id = p_stock_location_id,
    confirmation_started_at = statement_timestamp()
  where id = p_import_batch_id;

  for staged_row in
    select row.*
    from public.import_rows row
    where row.import_batch_id = p_import_batch_id
    order by row.row_number
  loop
    if staged_row.dry_run_action = 'IGNORED' then
      lines_ignored_count := lines_ignored_count + 1;
      update public.import_rows
      set
        promotion_action = 'IGNORED',
        promoted_at = statement_timestamp(),
        promotion_metadata = jsonb_build_object('mode', p_mode::text)
      where id = staged_row.id;
      continue;
    end if;

    if nullif(btrim(staged_row.normalized_data ->> 'sku'), '') is null
      or nullif(btrim(staged_row.normalized_data ->> 'name'), '') is null
      or nullif(btrim(staged_row.normalized_data ->> 'category'), '') is null
      or staged_row.normalized_data ->> 'unit' not in ('UN', 'KG')
      or staged_row.normalized_data ->> 'product_type' not in ('RAW', 'FRACTIONATED')
    then
      raise exception using
        errcode = '22023',
        message = format('row %s has incomplete normalized product data', staged_row.row_number);
    end if;

    parsed_minimum := coalesce(
      private.parse_import_quantity(
        staged_row.normalized_data ->> 'minimum_quantity',
        'minimum_quantity',
        staged_row.row_number
      ),
      0
    );
    parsed_external_quantity := private.parse_import_quantity(
      staged_row.normalized_data ->> 'opening_quantity',
      'opening_quantity',
      staged_row.row_number
    );
    ean_value := nullif(btrim(staged_row.normalized_data ->> 'ean'), '');
    external_id_value := nullif(btrim(staged_row.normalized_data ->> 'external_id'), '');

    if not private.is_valid_ean(ean_value) then
      raise exception using
        errcode = '22023',
        message = format('row %s has an invalid EAN', staged_row.row_number);
    end if;

    select category.*
    into category_record
    from public.categories category
    where lower(btrim(category.name)) = lower(btrim(staged_row.normalized_data ->> 'category'));

    if not found then
      if staged_row.category_candidate is null
        or coalesce(
          (staged_row.category_candidate ->> 'approvedForCreation')::boolean,
          false
        ) is not true
      then
        raise exception using
          errcode = '22000',
          message = format('row %s references a category not approved for creation', staged_row.row_number);
      end if;

      insert into public.categories (name, created_by, updated_by)
      values (btrim(staged_row.normalized_data ->> 'category'), actor_id, actor_id)
      returning * into category_record;
      categories_created_count := categories_created_count + 1;

      insert into public.audit_logs (
        actor_id, action, entity_type, entity_id, request_id, new_data, metadata
      ) values (
        actor_id,
        'IMPORT_CATEGORY_CREATED',
        'category',
        category_record.id::text,
        p_import_batch_id,
        to_jsonb(category_record),
        jsonb_build_object('import_batch_id', p_import_batch_id, 'row_number', staged_row.row_number)
      );
    elsif not category_record.is_active then
      raise exception using
        errcode = '55000',
        message = format('row %s references an inactive category', staged_row.row_number);
    end if;

    select coalesce(array_agg(distinct candidate.product_id), '{}'::uuid[])
    into matched_product_ids
    from (
      select staged_row.resolved_entity_id as product_id
      union all
      select mapping.internal_id
      from public.external_entity_mappings mapping
      where external_id_value is not null
        and mapping.source_system = batch_record.source_name
        and mapping.entity_type = 'PRODUCT'
        and mapping.external_id = external_id_value
      union all
      select product.id
      from public.products product
      where lower(btrim(product.sku)) = lower(btrim(staged_row.normalized_data ->> 'sku'))
      union all
      select product.id
      from public.products product
      where ean_value is not null and product.ean = ean_value
    ) candidate
    where candidate.product_id is not null;

    if staged_row.dry_run_action = 'NEW' then
      if staged_row.resolved_entity_id is not null or cardinality(matched_product_ids) <> 0 then
        raise exception using
          errcode = '22000',
          message = format('row %s became a product match after dry-run; run preview again', staged_row.row_number);
      end if;

      insert into public.products (
        name,
        sku,
        ean,
        product_type,
        unit,
        category_id,
        minimum_quantity,
        created_by,
        updated_by
      ) values (
        btrim(staged_row.normalized_data ->> 'name'),
        btrim(staged_row.normalized_data ->> 'sku'),
        ean_value,
        (staged_row.normalized_data ->> 'product_type')::public.product_type,
        (staged_row.normalized_data ->> 'unit')::public.unit_type,
        category_record.id,
        parsed_minimum,
        actor_id,
        actor_id
      )
      returning * into product_record;
      product_id_value := product_record.id;
      products_created_count := products_created_count + 1;
      promotion_value := 'CREATED';

      insert into public.audit_logs (
        actor_id, action, entity_type, entity_id, request_id, new_data, metadata
      ) values (
        actor_id,
        'IMPORT_PRODUCT_CREATED',
        'product',
        product_id_value::text,
        p_import_batch_id,
        to_jsonb(product_record),
        jsonb_build_object('import_batch_id', p_import_batch_id, 'row_number', staged_row.row_number)
      );
    else
      if staged_row.dry_run_action <> 'UPDATE_CANDIDATE'
        or staged_row.resolved_entity_id is null
        or cardinality(matched_product_ids) <> 1
        or matched_product_ids[1] <> staged_row.resolved_entity_id
      then
        raise exception using
          errcode = '22000',
          message = format('row %s does not resolve to one unambiguous product', staged_row.row_number);
      end if;

      select product.*
      into product_record
      from public.products product
      where product.id = staged_row.resolved_entity_id;

      if not found or not product_record.is_active then
        raise exception using
          errcode = '55000',
          message = format('row %s resolves to a missing or inactive product', staged_row.row_number);
      end if;

      product_id_value := product_record.id;
      products_associated_count := products_associated_count + 1;
      product_was_updated := false;

      insert into public.audit_logs (
        actor_id, action, entity_type, entity_id, request_id, new_data, metadata
      ) values (
        actor_id,
        'IMPORT_PRODUCT_ASSOCIATED',
        'product',
        product_id_value::text,
        p_import_batch_id,
        jsonb_build_object('product_id', product_id_value),
        jsonb_build_object('import_batch_id', p_import_batch_id, 'row_number', staged_row.row_number)
      );

      if p_existing_product_strategy = 'UPDATE_MASTER_DATA' and (
        product_record.name is distinct from btrim(staged_row.normalized_data ->> 'name')
        or product_record.sku is distinct from btrim(staged_row.normalized_data ->> 'sku')
        or product_record.ean is distinct from ean_value
        or product_record.product_type is distinct from
          (staged_row.normalized_data ->> 'product_type')::public.product_type
        or product_record.unit is distinct from
          (staged_row.normalized_data ->> 'unit')::public.unit_type
        or product_record.category_id is distinct from category_record.id
        or product_record.minimum_quantity is distinct from parsed_minimum
      ) then
        old_product_data := to_jsonb(product_record);
        update public.products
        set
          name = btrim(staged_row.normalized_data ->> 'name'),
          sku = btrim(staged_row.normalized_data ->> 'sku'),
          ean = ean_value,
          product_type = (staged_row.normalized_data ->> 'product_type')::public.product_type,
          unit = (staged_row.normalized_data ->> 'unit')::public.unit_type,
          category_id = category_record.id,
          minimum_quantity = parsed_minimum,
          updated_by = actor_id
        where id = product_id_value
        returning * into product_record;
        products_updated_count := products_updated_count + 1;
        product_was_updated := true;

        insert into public.audit_logs (
          actor_id, action, entity_type, entity_id, request_id, old_data, new_data, metadata
        ) values (
          actor_id,
          'IMPORT_PRODUCT_UPDATED',
          'product',
          product_id_value::text,
          p_import_batch_id,
          old_product_data,
          to_jsonb(product_record),
          jsonb_build_object('import_batch_id', p_import_batch_id, 'row_number', staged_row.row_number)
        );
      end if;

      promotion_value := case when product_was_updated then 'UPDATED' else 'ASSOCIATED' end;
    end if;

    if external_id_value is not null then
      existing_mapping_id := null;
      existing_mapping_internal_id := null;
      select mapping.id, mapping.internal_id
      into existing_mapping_id, existing_mapping_internal_id
      from public.external_entity_mappings mapping
      where mapping.source_system = batch_record.source_name
        and mapping.entity_type = 'PRODUCT'
        and mapping.external_id = external_id_value;

      if found and existing_mapping_internal_id <> product_id_value then
        raise exception using
          errcode = '22000',
          message = format('row %s external mapping points to another product', staged_row.row_number);
      elsif not found then
        insert into public.external_entity_mappings (
          source_system, entity_type, external_id, internal_id, metadata
        ) values (
          batch_record.source_name,
          'PRODUCT',
          external_id_value,
          product_id_value,
          jsonb_build_object(
            'import_batch_id', p_import_batch_id,
            'row_number', staged_row.row_number,
            'import_mode', p_mode::text
          )
        )
        returning id into mapping_id;

        insert into public.audit_logs (
          actor_id, action, entity_type, entity_id, request_id, new_data, metadata
        ) values (
          actor_id,
          'IMPORT_EXTERNAL_MAPPING_CREATED',
          'external_entity_mapping',
          mapping_id::text,
          p_import_batch_id,
          jsonb_build_object(
            'source_system', batch_record.source_name,
            'entity_type', 'PRODUCT',
            'external_id', external_id_value,
            'internal_id', product_id_value
          ),
          jsonb_build_object('import_batch_id', p_import_batch_id, 'row_number', staged_row.row_number)
        );
      end if;
    end if;

    if p_mode = 'INITIAL_MIGRATION' and coalesce(parsed_external_quantity, 0) > 0 then
      select *
      into stock_result
      from public.apply_migration_opening_balance(
        product_id_value,
        parsed_external_quantity,
        p_stock_location_id,
        p_import_batch_id,
        'import:' || p_import_batch_id::text || ':row:' || staged_row.id::text || ':opening'
      );
      if stock_result.applied then
        movements_created_count := movements_created_count + 1;
      end if;
    elsif p_mode = 'MASTER_DATA_IMPORT'
      and parsed_external_quantity is not null
      and p_master_quantity_strategy = 'IGNORE_EXTERNAL_QUANTITY'
    then
      external_quantities_ignored_count := external_quantities_ignored_count + 1;
    elsif p_mode = 'MASTER_DATA_IMPORT'
      and parsed_external_quantity is not null
      and p_master_quantity_strategy = 'RECONCILE_TO_EXTERNAL_QUANTITY'
    then
      select coalesce(balance.quantity, 0)
      into current_quantity
      from (select 1) singleton
      left join public.stock_balances balance on balance.product_id = product_id_value;
      quantity_delta := parsed_external_quantity - current_quantity;
      if quantity_delta <> 0 then
        select *
        into stock_result
        from private.execute_stock_movement(
          'reconcile_import_quantity',
          product_id_value,
          case
            when quantity_delta > 0 then 'ADJUSTMENT_POSITIVE'::public.movement_type
            else 'ADJUSTMENT_NEGATIVE'::public.movement_type
          end,
          abs(quantity_delta),
          quantity_delta,
          case when quantity_delta < 0 then p_stock_location_id else null end,
          case when quantity_delta > 0 then p_stock_location_id else null end,
          null,
          p_import_batch_id,
          null,
          'Reconciliação explícita de quantidade da importação mestre',
          'import:' || p_import_batch_id::text || ':row:' || staged_row.id::text || ':reconcile',
          true
        );
        if stock_result.applied then
          movements_created_count := movements_created_count + 1;
        end if;
      end if;
    end if;

    update public.import_rows
    set
      resolved_entity_id = product_id_value,
      promotion_action = promotion_value,
      promoted_at = statement_timestamp(),
      promotion_metadata = jsonb_build_object(
        'mode', p_mode::text,
        'existing_product_strategy', p_existing_product_strategy::text
      )
    where id = staged_row.id;
  end loop;

  final_report := jsonb_build_object(
    'total_rows', actual_rows,
    'products_created', products_created_count,
    'products_associated', products_associated_count,
    'products_updated', products_updated_count,
    'categories_created', categories_created_count,
    'movements_created', movements_created_count,
    'lines_ignored', lines_ignored_count,
    'external_quantities_ignored', external_quantities_ignored_count,
    'warnings', warning_count,
    'errors', 0
  );

  update public.import_batches
  set
    status = 'COMPLETED',
    confirmed_at = statement_timestamp(),
    confirmed_by = actor_id,
    confirmation_report = final_report
  where id = p_import_batch_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, request_id, new_data, metadata
  ) values (
    actor_id,
    'PRODUCT_IMPORT_COMPLETED',
    'import_batch',
    p_import_batch_id::text,
    p_import_batch_id,
    final_report,
    jsonb_build_object(
      'mode', p_mode::text,
      'existing_product_strategy', p_existing_product_strategy::text,
      'master_quantity_strategy', p_master_quantity_strategy
    )
  );

  return query select
    p_import_batch_id,
    p_mode,
    true,
    products_created_count,
    products_associated_count,
    products_updated_count,
    categories_created_count,
    movements_created_count,
    lines_ignored_count,
    external_quantities_ignored_count,
    warning_count,
    0;
end;
$$;

revoke all on function private.parse_import_quantity(text, text, integer)
from public, anon, authenticated;
revoke all on function private.is_valid_ean(text)
from public, anon, authenticated;
revoke all on function public.confirm_product_import(
  uuid,
  public.product_import_mode,
  public.existing_product_import_strategy,
  uuid,
  public.master_quantity_import_strategy
) from public, anon, authenticated;

grant execute on function public.confirm_product_import(
  uuid,
  public.product_import_mode,
  public.existing_product_import_strategy,
  uuid,
  public.master_quantity_import_strategy
) to authenticated;

comment on function public.confirm_product_import(
  uuid,
  public.product_import_mode,
  public.existing_product_import_strategy,
  uuid,
  public.master_quantity_import_strategy
) is 'Confirma staging de produtos de forma administrativa, atômica, idempotente e auditável.';

comment on column public.import_batches.confirmation_report is
  'Relatório imutável de resultado usado também no replay idempotente do lote concluído.';
comment on column public.import_rows.promotion_action is
  'Resultado definitivo da linha após confirmação transacional do lote.';

commit;
