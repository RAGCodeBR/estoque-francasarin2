begin;

create function private.build_operational_export_page(
  export_type_value text,
  page_value integer,
  page_size_value integer,
  total_value bigint,
  rows_value jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'export_type', export_type_value,
    'page', page_value,
    'page_size', page_size_value,
    'total', total_value,
    'rows', rows_value
  );
$$;

revoke all on function private.build_operational_export_page(text, integer, integer, bigint, jsonb)
from public, anon, authenticated;

create function public.export_operational_data_page(
  p_export_type text,
  p_filters jsonb default '{}'::jsonb,
  p_selected_ids uuid[] default null,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  export_type_value text := upper(nullif(btrim(p_export_type), ''));
  filters_value jsonb := coalesce(p_filters, '{}'::jsonb);
  allowed_filters text[];
  filter_key text;
  search_value text;
  is_active_value boolean;
  category_id_value uuid;
  product_id_value uuid;
  supplier_id_value uuid;
  location_id_value uuid;
  product_type_value public.product_type;
  unit_value public.unit_type;
  location_type_value public.location_type;
  movement_type_value public.movement_type;
  invoice_status_value public.invoice_status;
  created_from_value timestamptz;
  created_to_value timestamptz;
  result jsonb;
begin
  if (select auth.uid()) is null
    or not private.is_active_user()
    or not private.has_role('ADMIN')
  then
    raise exception using errcode = '42501', message = 'ADMIN role is required';
  end if;

  if export_type_value is null or export_type_value not in (
    'PRODUCTS', 'CATEGORIES', 'LOCATIONS', 'SUPPLIERS', 'STOCK_CURRENT',
    'STOCK_MOVEMENTS', 'LOSSES', 'INVOICES', 'PRODUCTS_WITH_CURRENT_STOCK'
  ) then
    raise exception using errcode = '22023', message = 'unsupported operational export type';
  end if;
  if jsonb_typeof(filters_value) <> 'object' then
    raise exception using errcode = '22023', message = 'export filters must be a JSON object';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 500 then
    raise exception using errcode = '22023', message = 'invalid export pagination';
  end if;
  if p_selected_ids is not null then
    if coalesce(cardinality(p_selected_ids), 0) > 10000 then
      raise exception using errcode = '22023', message = 'too many selected export identifiers';
    end if;
    if array_position(p_selected_ids, null) is not null then
      raise exception using errcode = '22023', message = 'selected export identifiers cannot contain null';
    end if;
  end if;

  allowed_filters := case export_type_value
    when 'PRODUCTS' then array['search', 'is_active', 'category_id', 'product_type', 'unit']
    when 'CATEGORIES' then array['search', 'is_active']
    when 'LOCATIONS' then array['search', 'is_active', 'location_type']
    when 'SUPPLIERS' then array['search', 'is_active']
    when 'STOCK_CURRENT' then array['search', 'is_active', 'category_id', 'product_type', 'unit']
    when 'PRODUCTS_WITH_CURRENT_STOCK' then array['search', 'is_active', 'category_id', 'product_type', 'unit']
    when 'STOCK_MOVEMENTS' then array['search', 'product_id', 'movement_type', 'created_from', 'created_to']
    when 'LOSSES' then array['search', 'product_id', 'category_id', 'location_id', 'created_from', 'created_to']
    when 'INVOICES' then array['search', 'supplier_id', 'product_id', 'category_id', 'invoice_status', 'created_from', 'created_to']
  end;

  for filter_key in select jsonb_object_keys(filters_value)
  loop
    if filter_key <> all(allowed_filters) then
      raise exception using
        errcode = '22023',
        message = format('unsupported filter "%s" for export type %s', filter_key, export_type_value);
    end if;
  end loop;

  if filters_value ? 'search' then
    if jsonb_typeof(filters_value -> 'search') <> 'string' then
      raise exception using errcode = '22023', message = 'search filter must be text';
    end if;
    search_value := nullif(btrim(filters_value ->> 'search'), '');
  end if;
  if filters_value ? 'is_active' then
    if jsonb_typeof(filters_value -> 'is_active') <> 'boolean' then
      raise exception using errcode = '22023', message = 'is_active filter must be boolean';
    end if;
    is_active_value := (filters_value ->> 'is_active')::boolean;
  end if;
  if filters_value ? 'category_id' then
    category_id_value := (filters_value ->> 'category_id')::uuid;
  end if;
  if filters_value ? 'product_id' then
    product_id_value := (filters_value ->> 'product_id')::uuid;
  end if;
  if filters_value ? 'supplier_id' then
    supplier_id_value := (filters_value ->> 'supplier_id')::uuid;
  end if;
  if filters_value ? 'location_id' then
    location_id_value := (filters_value ->> 'location_id')::uuid;
  end if;
  if filters_value ? 'product_type' then
    product_type_value := upper(filters_value ->> 'product_type')::public.product_type;
  end if;
  if filters_value ? 'unit' then
    unit_value := upper(filters_value ->> 'unit')::public.unit_type;
  end if;
  if filters_value ? 'location_type' then
    location_type_value := upper(filters_value ->> 'location_type')::public.location_type;
  end if;
  if filters_value ? 'movement_type' then
    movement_type_value := upper(filters_value ->> 'movement_type')::public.movement_type;
  end if;
  if filters_value ? 'invoice_status' then
    invoice_status_value := upper(filters_value ->> 'invoice_status')::public.invoice_status;
  end if;
  if filters_value ? 'created_from' then
    created_from_value := (filters_value ->> 'created_from')::timestamptz;
  end if;
  if filters_value ? 'created_to' then
    created_to_value := (filters_value ->> 'created_to')::timestamptz;
  end if;
  if created_from_value is not null and created_to_value is not null
    and created_from_value > created_to_value
  then
    raise exception using errcode = '22023', message = 'invalid export date range';
  end if;

  if export_type_value = 'PRODUCTS' then
    with filtered_rows as materialized (
      select
        product.id as product_id,
        product.sku,
        product.ean,
        product.name,
        category.id as category_id,
        category.name as category,
        product.product_type::text as product_type,
        product.unit::text as unit,
        product.minimum_quantity::text as minimum_quantity,
        product.is_active as active,
        product.created_at,
        product.updated_at
      from public.products product
      left join public.categories category on category.id = product.category_id
      where (p_selected_ids is null or product.id = any(p_selected_ids))
        and (search_value is null or product.name ilike '%' || search_value || '%'
          or product.sku ilike '%' || search_value || '%'
          or coalesce(product.ean, '') ilike '%' || search_value || '%')
        and (not filters_value ? 'is_active' or product.is_active = is_active_value)
        and (category_id_value is null or product.category_id = category_id_value)
        and (product_type_value is null or product.product_type = product_type_value)
        and (unit_value is null or product.unit = unit_value)
    ), page_rows as (
      select * from filtered_rows order by name, product_id
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size,
      (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by name, product_id) from page_rows), '[]'::jsonb)
    ) into result;
  elsif export_type_value = 'CATEGORIES' then
    with filtered_rows as materialized (
      select category.id as category_id, category.name, category.description,
        category.is_active as active, category.created_at, category.updated_at
      from public.categories category
      where (p_selected_ids is null or category.id = any(p_selected_ids))
        and (search_value is null or category.name ilike '%' || search_value || '%')
        and (not filters_value ? 'is_active' or category.is_active = is_active_value)
    ), page_rows as (
      select * from filtered_rows order by name, category_id
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by name, category_id) from page_rows), '[]'::jsonb)
    ) into result;
  elsif export_type_value = 'LOCATIONS' then
    with filtered_rows as materialized (
      select location.id as location_id, location.name, location.description,
        location.location_type::text as location_type, location.is_active as active,
        location.created_at, location.updated_at
      from public.locations location
      where (p_selected_ids is null or location.id = any(p_selected_ids))
        and (search_value is null or location.name ilike '%' || search_value || '%')
        and (not filters_value ? 'is_active' or location.is_active = is_active_value)
        and (location_type_value is null or location.location_type = location_type_value)
    ), page_rows as (
      select * from filtered_rows order by name, location_id
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by name, location_id) from page_rows), '[]'::jsonb)
    ) into result;
  elsif export_type_value = 'SUPPLIERS' then
    with filtered_rows as materialized (
      select supplier.id as supplier_id, supplier.document, supplier.legal_name,
        supplier.trade_name, supplier.is_active as active, supplier.created_at, supplier.updated_at
      from public.suppliers supplier
      where (p_selected_ids is null or supplier.id = any(p_selected_ids))
        and (search_value is null or supplier.legal_name ilike '%' || search_value || '%'
          or coalesce(supplier.trade_name, '') ilike '%' || search_value || '%'
          or coalesce(supplier.document, '') ilike '%' || search_value || '%')
        and (not filters_value ? 'is_active' or supplier.is_active = is_active_value)
    ), page_rows as (
      select * from filtered_rows order by legal_name, supplier_id
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by legal_name, supplier_id) from page_rows), '[]'::jsonb)
    ) into result;
  elsif export_type_value in ('STOCK_CURRENT', 'PRODUCTS_WITH_CURRENT_STOCK') then
    with filtered_rows as materialized (
      select product.id as product_id, product.sku, product.ean, product.name,
        category.id as category_id, category.name as category,
        product.product_type::text as product_type, product.unit::text as unit,
        coalesce(balance.quantity, 0)::numeric(18, 3)::text as current_quantity,
        product.minimum_quantity::text as minimum_quantity,
        case
          when coalesce(balance.quantity, 0) = 0 then 'OUT_OF_STOCK'
          when coalesce(balance.quantity, 0) <= product.minimum_quantity then 'BELOW_MINIMUM'
          else 'OK'
        end as situation,
        product.is_active as active,
        balance.updated_at as stock_updated_at,
        product.updated_at as product_updated_at
      from public.products product
      left join public.categories category on category.id = product.category_id
      left join public.stock_balances balance on balance.product_id = product.id
      where (p_selected_ids is null or product.id = any(p_selected_ids))
        and (search_value is null or product.name ilike '%' || search_value || '%'
          or product.sku ilike '%' || search_value || '%'
          or coalesce(product.ean, '') ilike '%' || search_value || '%')
        and (not filters_value ? 'is_active' or product.is_active = is_active_value)
        and (category_id_value is null or product.category_id = category_id_value)
        and (product_type_value is null or product.product_type = product_type_value)
        and (unit_value is null or product.unit = unit_value)
    ), page_rows as (
      select * from filtered_rows order by name, product_id
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by name, product_id) from page_rows), '[]'::jsonb)
    ) into result;
  elsif export_type_value = 'STOCK_MOVEMENTS' then
    with filtered_rows as materialized (
      select movement.id as movement_id, movement.product_id, product.sku,
        product.name as product_name, movement.movement_type::text as movement_type,
        movement.quantity::text as quantity, coalesce(movement.unit, product.unit)::text as unit,
        movement.source_location_id, source_location.name as source_location,
        movement.destination_location_id, destination_location.name as destination_location,
        movement.invoice_id, invoice.invoice_number, movement.import_batch_id,
        batch.source_name as import_source, movement.reference_id, movement.reason,
        movement.created_by as responsible_user_id,
        coalesce(profile.display_name, movement.created_by::text) as responsible,
        movement.created_at
      from public.stock_movements movement
      join public.products product on product.id = movement.product_id
      left join public.locations source_location on source_location.id = movement.source_location_id
      left join public.locations destination_location on destination_location.id = movement.destination_location_id
      left join public.invoices invoice on invoice.id = movement.invoice_id
      left join public.import_batches batch on batch.id = movement.import_batch_id
      left join public.profiles profile on profile.id = movement.created_by
      where (p_selected_ids is null or movement.id = any(p_selected_ids))
        and (search_value is null or product.name ilike '%' || search_value || '%'
          or product.sku ilike '%' || search_value || '%'
          or coalesce(movement.reason, '') ilike '%' || search_value || '%')
        and (product_id_value is null or movement.product_id = product_id_value)
        and (movement_type_value is null or movement.movement_type = movement_type_value)
        and (created_from_value is null or movement.created_at >= created_from_value)
        and (created_to_value is null or movement.created_at <= created_to_value)
    ), page_rows as (
      select * from filtered_rows order by created_at desc, movement_id desc
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc, movement_id desc) from page_rows), '[]'::jsonb)
    ) into result;
  elsif export_type_value = 'LOSSES' then
    with filtered_rows as materialized (
      select loss.id as loss_id, loss.movement_id, loss.product_id, product.sku,
        product.name as product_name, category.id as category_id, category.name as category,
        loss.quantity::text as quantity, loss.unit::text as unit,
        loss.location_id, location.name as location, loss.reason, loss.notes,
        loss.created_by as responsible_user_id,
        coalesce(profile.display_name, loss.created_by::text) as responsible,
        loss.created_at
      from public.stock_losses loss
      join public.products product on product.id = loss.product_id
      left join public.categories category on category.id = product.category_id
      join public.locations location on location.id = loss.location_id
      left join public.profiles profile on profile.id = loss.created_by
      where (p_selected_ids is null or loss.id = any(p_selected_ids))
        and (search_value is null or product.name ilike '%' || search_value || '%'
          or product.sku ilike '%' || search_value || '%'
          or loss.reason ilike '%' || search_value || '%')
        and (product_id_value is null or loss.product_id = product_id_value)
        and (category_id_value is null or product.category_id = category_id_value)
        and (location_id_value is null or loss.location_id = location_id_value)
        and (created_from_value is null or loss.created_at >= created_from_value)
        and (created_to_value is null or loss.created_at <= created_to_value)
    ), page_rows as (
      select * from filtered_rows order by created_at desc, loss_id desc
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc, loss_id desc) from page_rows), '[]'::jsonb)
    ) into result;
  else
    with filtered_rows as materialized (
      select invoice.id as invoice_id, invoice.access_key, invoice.invoice_number,
        invoice.series, invoice.status::text as invoice_status, invoice.issued_at,
        invoice.imported_at, invoice.supplier_id, supplier.document as supplier_document,
        supplier.legal_name as supplier_legal_name, supplier.trade_name as supplier_trade_name,
        item.id as invoice_item_id, item.line_number::text as line_number, item.product_id, product.sku,
        product.name as product_name, category.id as category_id, category.name as category,
        item.supplier_product_code, item.description as item_description,
        item.quantity::text as quantity, item.unit::text as unit,
        item.unit_price::text as unit_price, item.total_amount::text as total_amount,
        invoice.created_by as responsible_user_id,
        coalesce(profile.display_name, invoice.created_by::text) as responsible,
        invoice.created_at
      from public.invoices invoice
      join public.suppliers supplier on supplier.id = invoice.supplier_id
      left join public.invoice_items item on item.invoice_id = invoice.id
      left join public.products product on product.id = item.product_id
      left join public.categories category on category.id = product.category_id
      left join public.profiles profile on profile.id = invoice.created_by
      where (p_selected_ids is null or invoice.id = any(p_selected_ids))
        and (search_value is null or invoice.invoice_number ilike '%' || search_value || '%'
          or coalesce(invoice.access_key, '') ilike '%' || search_value || '%'
          or supplier.legal_name ilike '%' || search_value || '%'
          or coalesce(supplier.trade_name, '') ilike '%' || search_value || '%'
          or coalesce(product.name, '') ilike '%' || search_value || '%'
          or coalesce(product.sku, '') ilike '%' || search_value || '%')
        and (supplier_id_value is null or invoice.supplier_id = supplier_id_value)
        and (product_id_value is null or item.product_id = product_id_value)
        and (category_id_value is null or product.category_id = category_id_value)
        and (invoice_status_value is null or invoice.status = invoice_status_value)
        and (created_from_value is null or invoice.issued_at >= created_from_value)
        and (created_to_value is null or invoice.issued_at <= created_to_value)
    ), page_rows as (
      select * from filtered_rows
      order by issued_at desc, invoice_id, line_number nulls first, invoice_item_id
      limit p_page_size offset (p_page - 1) * p_page_size
    )
    select private.build_operational_export_page(
      export_type_value, p_page, p_page_size, (select count(*) from filtered_rows),
      coalesce((select jsonb_agg(to_jsonb(page_rows)
        order by issued_at desc, invoice_id, line_number nulls first, invoice_item_id
      ) from page_rows), '[]'::jsonb)
    ) into result;
  end if;

  return result;
end;
$$;

create or replace function public.record_administrative_export(
  p_export_type text,
  p_format text,
  p_row_count integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := (select auth.uid());
  export_type_value text := upper(nullif(btrim(p_export_type), ''));
  format_value text := upper(nullif(btrim(p_format), ''));
  canonical_key text := nullif(btrim(p_idempotency_key), '');
  existing_log public.audit_logs%rowtype;
  created_log public.audit_logs%rowtype;
  export_id uuid := gen_random_uuid();
begin
  if actor_id is null or not private.is_active_user() or not private.has_role('ADMIN') then
    raise exception using errcode = '42501', message = 'ADMIN role is required';
  end if;
  if export_type_value is null or export_type_value not in (
    'PRODUCTS', 'CATEGORIES', 'LOCATIONS', 'SUPPLIERS', 'STOCK_CURRENT',
    'STOCK_MOVEMENTS', 'LOSSES', 'INVOICES', 'PRODUCTS_WITH_CURRENT_STOCK',
    'INVENTORY', 'AUDIT_LOGS', 'IMPORT_REPORT'
  ) then
    raise exception using errcode = '22023', message = 'unsupported administrative export type';
  end if;
  if format_value is null or format_value not in ('CSV', 'XLSX', 'JSON') then
    raise exception using errcode = '22023', message = 'unsupported administrative export format';
  end if;
  if p_row_count is null or p_row_count < 0 then
    raise exception using errcode = '22023', message = 'row_count must be nonnegative';
  end if;
  if canonical_key is null or length(canonical_key) > 200 then
    raise exception using errcode = '22023', message = 'valid idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('audit:admin-export:' || canonical_key, 0));
  select audit.* into existing_log
  from public.audit_logs audit
  where audit.action = 'ADMIN_EXPORT_COMPLETED'
    and audit.metadata ->> 'idempotency_key' = canonical_key;

  if found then
    if existing_log.actor_id is distinct from actor_id
      or existing_log.new_data ->> 'export_type' is distinct from export_type_value
      or existing_log.new_data ->> 'format' is distinct from format_value
      or (existing_log.new_data ->> 'row_count')::integer is distinct from p_row_count
    then
      raise exception using
        errcode = '22000',
        message = 'idempotency_key was already used with a different export payload';
    end if;
    return jsonb_build_object(
      'auditLogId', existing_log.id,
      'exportId', existing_log.entity_id,
      'createdAt', existing_log.created_at,
      'applied', false
    );
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data, metadata
  ) values (
    actor_id, 'ADMIN_EXPORT_COMPLETED', 'data_export', export_id::text,
    jsonb_build_object(
      'export_type', export_type_value,
      'format', format_value,
      'row_count', p_row_count,
      'export_schema_version', 1
    ),
    jsonb_build_object('idempotency_key', canonical_key)
  ) returning * into created_log;

  return jsonb_build_object(
    'auditLogId', created_log.id,
    'exportId', created_log.entity_id,
    'createdAt', created_log.created_at,
    'applied', true
  );
end;
$$;

revoke all on function public.export_operational_data_page(text, jsonb, uuid[], integer, integer)
from public, anon, authenticated;
grant execute on function public.export_operational_data_page(text, jsonb, uuid[], integer, integer)
to authenticated;

comment on function public.export_operational_data_page(text, jsonb, uuid[], integer, integer) is
  'Consulta administrativa paginada, filtrada e sanitizada para exportações operacionais schema version 1.';

commit;
