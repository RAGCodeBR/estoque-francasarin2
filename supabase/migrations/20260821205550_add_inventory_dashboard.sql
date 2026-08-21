begin;

create function public.get_inventory_dashboard(
  p_days integer default 30,
  p_recent_limit integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  generated_at_value timestamptz := statement_timestamp();
  local_today date := timezone('America/Sao_Paulo', generated_at_value)::date;
  period_start_date date;
  period_start_value timestamptz;
  bucket_step interval;
  result jsonb;
begin
  perform private.assert_report_reader();

  if p_days is null or p_days not in (7, 30, 90) then
    raise exception using errcode = '22023', message = 'dashboard period must be 7, 30 or 90 days';
  end if;
  if p_recent_limit is null or p_recent_limit < 1 or p_recent_limit > 20 then
    raise exception using errcode = '22023', message = 'dashboard recent limit must be between 1 and 20';
  end if;

  period_start_date := local_today - (p_days - 1);
  period_start_value := period_start_date::timestamp at time zone 'America/Sao_Paulo';
  bucket_step := case when p_days <= 30 then interval '1 day' else interval '7 days' end;

  with stock_summary as materialized (
    select
      count(*)::integer as active_products,
      count(*) filter (
        where coalesce(balance.quantity, 0) > 0
          and coalesce(balance.quantity, 0) <= product.minimum_quantity
      )::integer as below_minimum,
      count(*) filter (where coalesce(balance.quantity, 0) = 0)::integer as out_of_stock
    from public.products product
    left join public.stock_balances balance on balance.product_id = product.id
    where product.is_active
  ), period_movements as materialized (
    select
      movement.id,
      movement.product_id,
      movement.movement_type,
      movement.quantity,
      coalesce(movement.unit, product.unit) as unit,
      movement.source_location_id,
      movement.destination_location_id,
      movement.reason,
      movement.created_at,
      movement.created_by,
      product.name as product_name,
      product.sku,
      product.category_id
    from public.stock_movements movement
    join public.products product on product.id = movement.product_id
    where movement.created_at >= period_start_value
      and movement.created_at <= generated_at_value
  ), movement_counts as (
    select
      count(*) filter (where movement_type = 'PURCHASE_ENTRY')::integer as entries,
      count(*) filter (where movement_type = 'CONSUMPTION_EXIT')::integer as consumption,
      count(*) filter (where movement_type = 'LOSS')::integer as losses,
      count(*)::integer as movements
    from period_movements
  ), quantity_totals as (
    select movement_type, unit, sum(quantity)::numeric(18, 3) as quantity
    from period_movements
    where movement_type in ('PURCHASE_ENTRY', 'CONSUMPTION_EXIT', 'LOSS')
    group by movement_type, unit
  ), bucket_dates as (
    select generated.bucket::date as bucket
    from generate_series(
      case
        when p_days <= 30 then period_start_date::timestamp
        else date_trunc('week', period_start_date::timestamp)
      end,
      local_today::timestamp,
      bucket_step
    ) as generated(bucket)
  ), units(unit) as (
    values ('KG'::public.unit_type), ('UN'::public.unit_type)
  ), consumption_buckets as (
    select
      case
        when p_days <= 30 then timezone('America/Sao_Paulo', movement.created_at)::date
        else date_trunc('week', timezone('America/Sao_Paulo', movement.created_at))::date
      end as bucket,
      movement.unit,
      sum(movement.quantity)::numeric(18, 3) as quantity
    from period_movements movement
    where movement.movement_type = 'CONSUMPTION_EXIT'
    group by 1, movement.unit
  ), consumption_trend as (
    select bucket.bucket, unit.unit,
      coalesce(consumption.quantity, 0)::numeric(18, 3) as quantity
    from bucket_dates bucket
    cross join units unit
    left join consumption_buckets consumption
      on consumption.bucket = bucket.bucket and consumption.unit = unit.unit
  ), consumed_products as (
    select movement.product_id, movement.product_name, movement.sku, movement.unit,
      sum(movement.quantity)::numeric(18, 3) as quantity
    from period_movements movement
    where movement.movement_type = 'CONSUMPTION_EXIT'
    group by movement.product_id, movement.product_name, movement.sku, movement.unit
  ), ranked_products as (
    select consumed.*,
      row_number() over (
        partition by consumed.unit
        order by consumed.quantity desc, consumed.product_name, consumed.product_id
      ) as position
    from consumed_products consumed
  ), loss_categories as (
    select movement.category_id, coalesce(category.name, 'Sem categoria') as category_name,
      movement.unit, sum(movement.quantity)::numeric(18, 3) as quantity
    from period_movements movement
    left join public.categories category on category.id = movement.category_id
    where movement.movement_type = 'LOSS'
    group by movement.category_id, category.name, movement.unit
  ), ranked_loss_categories as (
    select loss_category.*,
      row_number() over (
        partition by loss_category.unit
        order by loss_category.quantity desc, loss_category.category_name,
          loss_category.category_id nulls last
      ) as position
    from loss_categories loss_category
  ), consumption_locations as (
    select movement.destination_location_id as location_id,
      coalesce(location.name, 'Local não informado') as location_name,
      movement.unit, sum(movement.quantity)::numeric(18, 3) as quantity
    from period_movements movement
    left join public.locations location on location.id = movement.destination_location_id
    where movement.movement_type = 'CONSUMPTION_EXIT'
    group by movement.destination_location_id, location.name, movement.unit
  ), ranked_consumption_locations as (
    select consumption_location.*,
      row_number() over (
        partition by consumption_location.unit
        order by consumption_location.quantity desc, consumption_location.location_name,
          consumption_location.location_id nulls last
      ) as position
    from consumption_locations consumption_location
  ), recent_rows as (
    select movement.*, source_location.name as source_location_name,
      destination_location.name as destination_location_name,
      coalesce(profile.display_name, movement.created_by::text) as responsible_name
    from period_movements movement
    left join public.locations source_location on source_location.id = movement.source_location_id
    left join public.locations destination_location
      on destination_location.id = movement.destination_location_id
    left join public.profiles profile on profile.id = movement.created_by
    order by movement.created_at desc, movement.id desc
    limit p_recent_limit
  )
  select jsonb_build_object(
    'period_days', p_days,
    'period_start', period_start_value,
    'generated_at', generated_at_value,
    'indicators', jsonb_build_object(
      'active_products', stock.active_products,
      'below_minimum', stock.below_minimum,
      'out_of_stock', stock.out_of_stock,
      'entries', jsonb_build_object(
        'movement_count', counts.entries,
        'quantities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unit', quantity.unit::text, 'quantity', quantity.quantity::text
          ) order by quantity.unit)
          from quantity_totals quantity where quantity.movement_type = 'PURCHASE_ENTRY'
        ), '[]'::jsonb)
      ),
      'consumption', jsonb_build_object(
        'movement_count', counts.consumption,
        'quantities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unit', quantity.unit::text, 'quantity', quantity.quantity::text
          ) order by quantity.unit)
          from quantity_totals quantity where quantity.movement_type = 'CONSUMPTION_EXIT'
        ), '[]'::jsonb)
      ),
      'losses', jsonb_build_object(
        'movement_count', counts.losses,
        'quantities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unit', quantity.unit::text, 'quantity', quantity.quantity::text
          ) order by quantity.unit)
          from quantity_totals quantity where quantity.movement_type = 'LOSS'
        ), '[]'::jsonb)
      ),
      'movements', counts.movements
    ),
    'consumption_trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period_start', trend.bucket,
        'unit', trend.unit::text,
        'quantity', trend.quantity::text
      ) order by trend.bucket, trend.unit)
      from consumption_trend trend
    ), '[]'::jsonb),
    'top_consumed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', product.product_id,
        'product_name', product.product_name,
        'sku', product.sku,
        'unit', product.unit::text,
        'quantity', product.quantity::text
      ) order by product.unit, product.position)
      from ranked_products product where product.position <= 5
    ), '[]'::jsonb),
    'losses_by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', loss_category.category_id,
        'category_name', loss_category.category_name,
        'unit', loss_category.unit::text,
        'quantity', loss_category.quantity::text
      ) order by loss_category.unit, loss_category.position)
      from ranked_loss_categories loss_category where loss_category.position <= 6
    ), '[]'::jsonb),
    'consumption_by_location', coalesce((
      select jsonb_agg(jsonb_build_object(
        'location_id', consumption_location.location_id,
        'location_name', consumption_location.location_name,
        'unit', consumption_location.unit::text,
        'quantity', consumption_location.quantity::text
      ) order by consumption_location.unit, consumption_location.position)
      from ranked_consumption_locations consumption_location
      where consumption_location.position <= 6
    ), '[]'::jsonb),
    'recent_movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id,
        'product_id', recent.product_id,
        'product_name', recent.product_name,
        'sku', recent.sku,
        'movement_type', recent.movement_type::text,
        'quantity', recent.quantity::text,
        'unit', recent.unit::text,
        'source_location_id', recent.source_location_id,
        'source_location_name', recent.source_location_name,
        'destination_location_id', recent.destination_location_id,
        'destination_location_name', recent.destination_location_name,
        'responsible_name', recent.responsible_name,
        'reason', recent.reason,
        'created_at', recent.created_at
      ) order by recent.created_at desc, recent.id desc)
      from recent_rows recent
    ), '[]'::jsonb)
  ) into result
  from stock_summary stock
  cross join movement_counts counts;

  return result;
end;
$$;

revoke all on function public.get_inventory_dashboard(integer, integer)
from public, anon, authenticated;
grant execute on function public.get_inventory_dashboard(integer, integer)
to authenticated;

comment on function public.get_inventory_dashboard(integer, integer) is
  'Retorna indicadores, séries agregadas por unidade e movimentos recentes para usuários de relatórios autorizados.';

commit;
