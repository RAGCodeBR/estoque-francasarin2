begin;

create function private.prevent_master_data_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I cannot be deleted; change is_active instead', tg_table_name);
end;
$$;

create trigger categories_prevent_delete
before delete on public.categories
for each statement execute function private.prevent_master_data_delete();

create trigger locations_prevent_delete
before delete on public.locations
for each statement execute function private.prevent_master_data_delete();

create trigger products_prevent_delete
before delete on public.products
for each statement execute function private.prevent_master_data_delete();

create function public.search_categories(
  p_search text default null,
  p_is_active boolean default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  search_value text := nullif(btrim(p_search), '');
  row_offset integer;
begin
  if p_page is null or p_page < 1 then
    raise exception using errcode = '22023', message = 'page must be a positive integer';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'page_size must be between 1 and 100';
  end if;
  row_offset := (p_page - 1) * p_page_size;

  return (
    with filtered as materialized (
      select
        category.id,
        category.name,
        category.description,
        category.is_active,
        category.created_at,
        category.updated_at
      from public.categories category
      where (p_is_active is null or category.is_active = p_is_active)
        and (search_value is null or category.name ilike '%' || search_value || '%')
    ),
    paged as (
      select filtered.*
      from filtered
      order by filtered.name, filtered.id
      limit p_page_size offset row_offset
    )
    select jsonb_build_object(
      'page', p_page,
      'page_size', p_page_size,
      'total', (select count(*) from filtered),
      'items', coalesce(
        (select jsonb_agg(to_jsonb(item) order by item.name, item.id) from paged item),
        '[]'::jsonb
      )
    )
  );
end;
$$;

create function public.search_locations(
  p_search text default null,
  p_location_type public.location_type default null,
  p_is_active boolean default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  search_value text := nullif(btrim(p_search), '');
  row_offset integer;
begin
  if p_page is null or p_page < 1 then
    raise exception using errcode = '22023', message = 'page must be a positive integer';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'page_size must be between 1 and 100';
  end if;
  row_offset := (p_page - 1) * p_page_size;

  return (
    with filtered as materialized (
      select
        location.id,
        location.name,
        location.description,
        location.location_type,
        location.is_active,
        location.created_at,
        location.updated_at
      from public.locations location
      where (p_location_type is null or location.location_type = p_location_type)
        and (p_is_active is null or location.is_active = p_is_active)
        and (search_value is null or location.name ilike '%' || search_value || '%')
    ),
    paged as (
      select filtered.*
      from filtered
      order by filtered.name, filtered.id
      limit p_page_size offset row_offset
    )
    select jsonb_build_object(
      'page', p_page,
      'page_size', p_page_size,
      'total', (select count(*) from filtered),
      'items', coalesce(
        (select jsonb_agg(to_jsonb(item) order by item.name, item.id) from paged item),
        '[]'::jsonb
      )
    )
  );
end;
$$;

create function public.search_products(
  p_search text default null,
  p_category_id uuid default null,
  p_product_type public.product_type default null,
  p_unit public.unit_type default null,
  p_is_active boolean default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  search_value text := nullif(btrim(p_search), '');
  row_offset integer;
begin
  if p_page is null or p_page < 1 then
    raise exception using errcode = '22023', message = 'page must be a positive integer';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'page_size must be between 1 and 100';
  end if;
  row_offset := (p_page - 1) * p_page_size;

  return (
    with filtered as materialized (
      select
        product.id,
        product.name,
        product.sku,
        product.ean,
        product.product_type,
        product.unit,
        jsonb_build_object('id', category.id, 'name', category.name) as category,
        product.minimum_quantity::text as minimum_quantity,
        product.is_active,
        product.created_at,
        product.updated_at
      from public.products product
      join public.categories category on category.id = product.category_id
      where (p_category_id is null or product.category_id = p_category_id)
        and (p_product_type is null or product.product_type = p_product_type)
        and (p_unit is null or product.unit = p_unit)
        and (p_is_active is null or product.is_active = p_is_active)
        and (
          search_value is null
          or product.name ilike '%' || search_value || '%'
          or product.sku ilike '%' || search_value || '%'
          or product.ean ilike '%' || search_value || '%'
        )
    ),
    paged as (
      select filtered.*
      from filtered
      order by filtered.name, filtered.id
      limit p_page_size offset row_offset
    )
    select jsonb_build_object(
      'page', p_page,
      'page_size', p_page_size,
      'total', (select count(*) from filtered),
      'items', coalesce(
        (select jsonb_agg(to_jsonb(item) order by item.name, item.id) from paged item),
        '[]'::jsonb
      )
    )
  );
end;
$$;

create function public.get_product(p_product_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', product.id,
    'name', product.name,
    'sku', product.sku,
    'ean', product.ean,
    'product_type', product.product_type,
    'unit', product.unit,
    'category', jsonb_build_object('id', category.id, 'name', category.name),
    'minimum_quantity', product.minimum_quantity::text,
    'is_active', product.is_active,
    'created_at', product.created_at,
    'updated_at', product.updated_at
  )
  from public.products product
  join public.categories category on category.id = product.category_id
  where product.id = p_product_id;
$$;

revoke all on function private.prevent_master_data_delete()
from public, anon, authenticated;

revoke all on function public.search_categories(text, boolean, integer, integer)
from public, anon, authenticated;
revoke all on function public.search_locations(
  text,
  public.location_type,
  boolean,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function public.search_products(
  text,
  uuid,
  public.product_type,
  public.unit_type,
  boolean,
  integer,
  integer
) from public, anon, authenticated;
revoke all on function public.get_product(uuid)
from public, anon, authenticated;

grant execute on function public.search_categories(text, boolean, integer, integer)
to authenticated;
grant execute on function public.search_locations(
  text,
  public.location_type,
  boolean,
  integer,
  integer
) to authenticated;
grant execute on function public.search_products(
  text,
  uuid,
  public.product_type,
  public.unit_type,
  boolean,
  integer,
  integer
) to authenticated;
grant execute on function public.get_product(uuid)
to authenticated;

comment on function public.search_products(
  text,
  uuid,
  public.product_type,
  public.unit_type,
  boolean,
  integer,
  integer
) is 'Pesquisa produtos por nome, SKU ou EAN com filtros e paginação server-side limitada a 100.';

commit;
