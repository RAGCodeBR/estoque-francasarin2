begin;

create function private.assert_report_reader()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is null
    or not private.is_active_user()
    or not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])
  then
    raise exception using errcode = '42501', message = 'report access is not authorized';
  end if;
end;
$$;

revoke all on function private.assert_report_reader() from public, anon, authenticated;

create function public.report_current_stock(
  p_search text default null,
  p_category_id uuid default null,
  p_product_type public.product_type default null,
  p_unit public.unit_type default null,
  p_situation text default null,
  p_is_active boolean default true,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_search text := nullif(btrim(p_search), '');
  normalized_situation text := nullif(upper(btrim(p_situation)), '');
  result jsonb;
begin
  perform private.assert_report_reader();
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid report pagination';
  end if;
  if normalized_situation is not null
    and normalized_situation <> all(array['OUT_OF_STOCK', 'BELOW_MINIMUM', 'OK'])
  then
    raise exception using errcode = '22023', message = 'invalid stock situation';
  end if;

  with report_rows as materialized (
    select
      product.id as product_id,
      product.name as product_name,
      product.sku,
      category.id as category_id,
      category.name as category_name,
      product.product_type,
      product.unit,
      coalesce(balance.quantity, 0::numeric(18, 3)) as balance,
      product.minimum_quantity,
      case
        when coalesce(balance.quantity, 0) = 0 then 'OUT_OF_STOCK'
        when coalesce(balance.quantity, 0) <= product.minimum_quantity then 'BELOW_MINIMUM'
        else 'OK'
      end as situation,
      product.is_active
    from public.products product
    left join public.categories category on category.id = product.category_id
    left join public.stock_balances balance on balance.product_id = product.id
    where (p_is_active is null or product.is_active = p_is_active)
      and (p_category_id is null or product.category_id = p_category_id)
      and (p_product_type is null or product.product_type = p_product_type)
      and (p_unit is null or product.unit = p_unit)
      and (
        normalized_search is null
        or product.name ilike '%' || normalized_search || '%'
        or product.sku ilike '%' || normalized_search || '%'
        or coalesce(category.name, '') ilike '%' || normalized_search || '%'
      )
  ), filtered_rows as materialized (
    select * from report_rows row_data
    where normalized_situation is null or row_data.situation = normalized_situation
  ), page_rows as (
    select row_data.*
    from filtered_rows row_data
    order by row_data.product_name, row_data.product_id
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page,
    'page_size', p_page_size,
    'total', (select count(*) from filtered_rows),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', row_data.product_id,
      'product_name', row_data.product_name,
      'sku', row_data.sku,
      'category_id', row_data.category_id,
      'category_name', row_data.category_name,
      'product_type', row_data.product_type::text,
      'unit', row_data.unit::text,
      'balance', row_data.balance::text,
      'minimum_quantity', row_data.minimum_quantity::text,
      'situation', row_data.situation,
      'is_active', row_data.is_active
    ) order by row_data.product_name, row_data.product_id) from page_rows row_data), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.report_consumption(
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_location_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare result jsonb;
begin
  perform private.assert_report_reader();
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid report pagination';
  end if;
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with grouped_rows as materialized (
    select
      movement.product_id,
      product.name as product_name,
      product.sku,
      category.id as category_id,
      category.name as category_name,
      movement.destination_location_id as location_id,
      location.name as location_name,
      product.unit,
      sum(movement.quantity)::numeric(18, 3) as quantity,
      min(movement.created_at) as period_start,
      max(movement.created_at) as period_end
    from public.stock_movements movement
    join public.products product on product.id = movement.product_id
    left join public.categories category on category.id = product.category_id
    left join public.locations location on location.id = movement.destination_location_id
    where movement.movement_type = 'CONSUMPTION_EXIT'
      and (p_created_from is null or movement.created_at >= p_created_from)
      and (p_created_to is null or movement.created_at <= p_created_to)
      and (p_product_id is null or movement.product_id = p_product_id)
      and (p_category_id is null or product.category_id = p_category_id)
      and (p_location_id is null or movement.destination_location_id = p_location_id)
    group by movement.product_id, product.name, product.sku, category.id, category.name,
      movement.destination_location_id, location.name, product.unit
  ), page_rows as (
    select row_data.* from grouped_rows row_data
    order by row_data.quantity desc, row_data.product_name, row_data.location_name nulls last,
      row_data.product_id
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page, 'page_size', p_page_size,
    'total', (select count(*) from grouped_rows),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', row_data.product_id, 'product_name', row_data.product_name, 'sku', row_data.sku,
      'category_id', row_data.category_id, 'category_name', row_data.category_name,
      'location_id', row_data.location_id, 'location_name', row_data.location_name,
      'unit', row_data.unit::text, 'quantity', row_data.quantity::text,
      'period_start', row_data.period_start, 'period_end', row_data.period_end
    ) order by row_data.quantity desc, row_data.product_name, row_data.location_name nulls last,
      row_data.product_id) from page_rows row_data), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.report_losses(
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_location_id uuid default null,
  p_created_by uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare result jsonb;
begin
  perform private.assert_report_reader();
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid report pagination';
  end if;
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with filtered_rows as materialized (
    select loss.id, loss.movement_id, loss.product_id, product.name as product_name,
      product.sku, category.id as category_id, category.name as category_name,
      loss.quantity, loss.unit, loss.reason, loss.notes, loss.location_id,
      location.name as location_name, loss.created_by,
      coalesce(profile.display_name, loss.created_by::text) as responsible_name,
      loss.created_at
    from public.stock_losses loss
    join public.products product on product.id = loss.product_id
    left join public.categories category on category.id = product.category_id
    join public.locations location on location.id = loss.location_id
    left join public.profiles profile on profile.id = loss.created_by
    where (p_created_from is null or loss.created_at >= p_created_from)
      and (p_created_to is null or loss.created_at <= p_created_to)
      and (p_product_id is null or loss.product_id = p_product_id)
      and (p_category_id is null or product.category_id = p_category_id)
      and (p_location_id is null or loss.location_id = p_location_id)
      and (p_created_by is null or loss.created_by = p_created_by)
  ), page_rows as (
    select row_data.* from filtered_rows row_data
    order by row_data.created_at desc, row_data.id desc
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page, 'page_size', p_page_size, 'total', (select count(*) from filtered_rows),
    'items', coalesce((select jsonb_agg(to_jsonb(row_data) || jsonb_build_object(
      'quantity', row_data.quantity::text, 'unit', row_data.unit::text
    ) order by row_data.created_at desc, row_data.id desc) from page_rows row_data), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.report_entries(
  p_issued_from timestamptz default null,
  p_issued_to timestamptz default null,
  p_supplier_id uuid default null,
  p_invoice_id uuid default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare result jsonb;
begin
  perform private.assert_report_reader();
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid report pagination';
  end if;
  if p_issued_from is not null and p_issued_to is not null and p_issued_from > p_issued_to then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with filtered_rows as materialized (
    select item.id, invoice.id as invoice_id, invoice.invoice_number, invoice.series,
      invoice.issued_at, supplier.id as supplier_id, supplier.legal_name as supplier_legal_name,
      supplier.trade_name as supplier_trade_name, product.id as product_id,
      product.name as product_name, product.sku, category.id as category_id,
      category.name as category_name, item.quantity, item.unit, item.unit_price, item.total_amount
    from public.invoice_items item
    join public.invoices invoice on invoice.id = item.invoice_id
    join public.suppliers supplier on supplier.id = invoice.supplier_id
    join public.products product on product.id = item.product_id
    left join public.categories category on category.id = product.category_id
    where invoice.status = 'CONFIRMED'
      and (p_issued_from is null or invoice.issued_at >= p_issued_from)
      and (p_issued_to is null or invoice.issued_at <= p_issued_to)
      and (p_supplier_id is null or invoice.supplier_id = p_supplier_id)
      and (p_invoice_id is null or invoice.id = p_invoice_id)
      and (p_product_id is null or item.product_id = p_product_id)
      and (p_category_id is null or product.category_id = p_category_id)
  ), page_rows as (
    select row_data.* from filtered_rows row_data
    order by row_data.issued_at desc, row_data.invoice_id, row_data.id
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page, 'page_size', p_page_size, 'total', (select count(*) from filtered_rows),
    'items', coalesce((select jsonb_agg(to_jsonb(row_data) || jsonb_build_object(
      'quantity', row_data.quantity::text, 'unit', row_data.unit::text,
      'unit_price', row_data.unit_price::text, 'total_amount', row_data.total_amount::text
    ) order by row_data.issued_at desc, row_data.invoice_id, row_data.id) from page_rows row_data), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.report_stock_movements(
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_product_id uuid default null,
  p_movement_type public.movement_type default null,
  p_source_location_id uuid default null,
  p_destination_location_id uuid default null,
  p_created_by uuid default null,
  p_reference_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare result jsonb;
begin
  perform private.assert_report_reader();
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid report pagination';
  end if;
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with filtered_rows as materialized (
    select movement.id, movement.product_id, product.name as product_name, product.sku,
      movement.movement_type, movement.quantity, coalesce(movement.unit, product.unit) as unit,
      movement.source_location_id, source_location.name as source_location_name,
      movement.destination_location_id, destination_location.name as destination_location_name,
      movement.created_by, coalesce(profile.display_name, movement.created_by::text) as responsible_name,
      movement.created_at, movement.reason, movement.reference_id,
      movement.invoice_id, movement.import_batch_id
    from public.stock_movements movement
    join public.products product on product.id = movement.product_id
    left join public.locations source_location on source_location.id = movement.source_location_id
    left join public.locations destination_location on destination_location.id = movement.destination_location_id
    left join public.profiles profile on profile.id = movement.created_by
    where (p_created_from is null or movement.created_at >= p_created_from)
      and (p_created_to is null or movement.created_at <= p_created_to)
      and (p_product_id is null or movement.product_id = p_product_id)
      and (p_movement_type is null or movement.movement_type = p_movement_type)
      and (p_source_location_id is null or movement.source_location_id = p_source_location_id)
      and (p_destination_location_id is null or movement.destination_location_id = p_destination_location_id)
      and (p_created_by is null or movement.created_by = p_created_by)
      and (p_reference_id is null or movement.reference_id = p_reference_id
        or movement.invoice_id = p_reference_id or movement.import_batch_id = p_reference_id)
  ), page_rows as (
    select row_data.* from filtered_rows row_data
    order by row_data.created_at desc, row_data.id desc
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page, 'page_size', p_page_size, 'total', (select count(*) from filtered_rows),
    'items', coalesce((select jsonb_agg(to_jsonb(row_data) || jsonb_build_object(
      'movement_type', row_data.movement_type::text,
      'quantity', row_data.quantity::text,
      'unit', row_data.unit::text
    ) order by row_data.created_at desc, row_data.id desc) from page_rows row_data), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.report_migration_opening_balances(
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_import_batch_id uuid default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_source text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_source text := nullif(btrim(p_source), '');
  result jsonb;
begin
  perform private.assert_report_reader();
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid report pagination';
  end if;
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    raise exception using errcode = '22023', message = 'invalid report date range';
  end if;

  with filtered_rows as materialized (
    select movement.id as movement_id, movement.product_id, product.name as product_name,
      product.sku, category.id as category_id, category.name as category_name,
      movement.quantity as opening_quantity, coalesce(movement.unit, product.unit) as unit,
      movement.import_batch_id, batch.source_type, batch.source_name,
      movement.reason as origin, movement.created_at
    from public.stock_movements movement
    join public.products product on product.id = movement.product_id
    left join public.categories category on category.id = product.category_id
    join public.import_batches batch on batch.id = movement.import_batch_id
    where movement.movement_type = 'MIGRATION_OPENING_BALANCE'
      and (p_created_from is null or movement.created_at >= p_created_from)
      and (p_created_to is null or movement.created_at <= p_created_to)
      and (p_import_batch_id is null or movement.import_batch_id = p_import_batch_id)
      and (p_product_id is null or movement.product_id = p_product_id)
      and (p_category_id is null or product.category_id = p_category_id)
      and (normalized_source is null or batch.source_name ilike '%' || normalized_source || '%'
        or batch.source_type ilike '%' || normalized_source || '%')
  ), page_rows as (
    select row_data.* from filtered_rows row_data
    order by row_data.created_at desc, row_data.movement_id desc
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select jsonb_build_object(
    'page', p_page, 'page_size', p_page_size, 'total', (select count(*) from filtered_rows),
    'items', coalesce((select jsonb_agg(to_jsonb(row_data) || jsonb_build_object(
      'opening_quantity', row_data.opening_quantity::text, 'unit', row_data.unit::text
    ) order by row_data.created_at desc, row_data.movement_id desc) from page_rows row_data), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create index stock_movements_type_created_at_report_idx
  on public.stock_movements (movement_type, created_at desc, id desc);
create index stock_movements_destination_type_created_at_report_idx
  on public.stock_movements (destination_location_id, movement_type, created_at desc, id desc)
  where destination_location_id is not null;
create index stock_movements_source_type_created_at_report_idx
  on public.stock_movements (source_location_id, movement_type, created_at desc, id desc)
  where source_location_id is not null;
create index stock_movements_actor_created_at_report_idx
  on public.stock_movements (created_by, created_at desc, id desc);
create index stock_movements_batch_type_created_at_report_idx
  on public.stock_movements (import_batch_id, movement_type, created_at desc, id desc)
  where import_batch_id is not null;
create index stock_losses_created_at_report_idx
  on public.stock_losses (created_at desc, id desc);
create index stock_losses_actor_created_at_report_idx
  on public.stock_losses (created_by, created_at desc, id desc);
create index invoices_issued_at_report_idx
  on public.invoices (issued_at desc, id desc);
create index invoices_supplier_issued_at_report_idx
  on public.invoices (supplier_id, issued_at desc, id desc);
create index invoice_items_product_invoice_report_idx
  on public.invoice_items (product_id, invoice_id);

revoke all on function public.report_current_stock(text, uuid, public.product_type, public.unit_type, text, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.report_consumption(timestamptz, timestamptz, uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.report_losses(timestamptz, timestamptz, uuid, uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.report_entries(timestamptz, timestamptz, uuid, uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.report_stock_movements(timestamptz, timestamptz, uuid, public.movement_type, uuid, uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.report_migration_opening_balances(timestamptz, timestamptz, uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated;

grant execute on function public.report_current_stock(text, uuid, public.product_type, public.unit_type, text, boolean, integer, integer) to authenticated;
grant execute on function public.report_consumption(timestamptz, timestamptz, uuid, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.report_losses(timestamptz, timestamptz, uuid, uuid, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.report_entries(timestamptz, timestamptz, uuid, uuid, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.report_stock_movements(timestamptz, timestamptz, uuid, public.movement_type, uuid, uuid, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.report_migration_opening_balances(timestamptz, timestamptz, uuid, uuid, uuid, text, integer, integer) to authenticated;

commit;
