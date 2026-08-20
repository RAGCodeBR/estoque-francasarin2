create type public.invoice_import_status as enum (
  'UPLOADED',
  'PENDING_REVIEW',
  'READY',
  'CONFIRMED',
  'FAILED',
  'CANCELLED'
);

create type public.invoice_item_match_source as enum (
  'NONE',
  'SUPPLIER_PRODUCT_CODE',
  'EAN',
  'MANUAL'
);

create function private.is_valid_cnpj(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  weights1 integer[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  weights2 integer[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  total integer := 0;
  digit1 integer;
  digit2 integer;
  idx integer;
begin
  if p_value !~ '^[0-9]{14}$' or p_value ~ '^([0-9])\1{13}$' then return false; end if;
  for idx in 1..12 loop total := total + substr(p_value, idx, 1)::integer * weights1[idx]; end loop;
  digit1 := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  total := 0;
  for idx in 1..13 loop total := total + substr(p_value, idx, 1)::integer * weights2[idx]; end loop;
  digit2 := case when total % 11 < 2 then 0 else 11 - total % 11 end;
  return digit1 = substr(p_value, 13, 1)::integer and digit2 = substr(p_value, 14, 1)::integer;
end;
$$;

create function private.is_valid_nfe_access_key(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  total integer := 0;
  weight integer := 2;
  idx integer;
  expected integer;
begin
  if p_value !~ '^[0-9]{44}$' then return false; end if;
  for idx in reverse 43..1 loop
    total := total + substr(p_value, idx, 1)::integer * weight;
    weight := case when weight = 9 then 2 else weight + 1 end;
  end loop;
  expected := case when total % 11 in (0, 1) then 0 else 11 - total % 11 end;
  return expected = substr(p_value, 44, 1)::integer;
end;
$$;

create table public.invoice_imports (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null,
  original_filename text not null,
  original_file_path text,
  access_key text,
  invoice_number text not null,
  series text,
  issued_at timestamptz not null,
  supplier_document text not null,
  supplier_legal_name text not null,
  supplier_trade_name text,
  resolved_supplier_id uuid references public.suppliers (id) on delete restrict,
  status public.invoice_import_status not null default 'UPLOADED',
  validation_errors jsonb not null default '[]'::jsonb,
  confirmation_idempotency_key text,
  confirmed_invoice_id uuid references public.invoices (id) on delete restrict,
  confirmation_report jsonb,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  constraint invoice_imports_file_hash_format check (file_hash ~ '^[0-9a-f]{64}$'),
  constraint invoice_imports_filename_not_blank check (btrim(original_filename) <> ''),
  constraint invoice_imports_path_not_blank check (
    original_file_path is null or btrim(original_file_path) <> ''
  ),
  constraint invoice_imports_access_key_format check (
    access_key is null or private.is_valid_nfe_access_key(access_key)
  ),
  constraint invoice_imports_number_not_blank check (btrim(invoice_number) <> ''),
  constraint invoice_imports_series_not_blank check (series is null or btrim(series) <> ''),
  constraint invoice_imports_supplier_document_format check (private.is_valid_cnpj(supplier_document)),
  constraint invoice_imports_supplier_name_not_blank check (btrim(supplier_legal_name) <> ''),
  constraint invoice_imports_trade_name_not_blank check (
    supplier_trade_name is null or btrim(supplier_trade_name) <> ''
  ),
  constraint invoice_imports_errors_array check (jsonb_typeof(validation_errors) = 'array'),
  constraint invoice_imports_report_object check (
    confirmation_report is null or jsonb_typeof(confirmation_report) = 'object'
  ),
  constraint invoice_imports_confirmation_consistent check (
    (status = 'CONFIRMED' and confirmation_idempotency_key is not null
      and confirmed_invoice_id is not null and confirmation_report is not null
      and confirmed_at is not null and confirmed_by is not null)
    or
    (status <> 'CONFIRMED' and confirmed_invoice_id is null and confirmed_at is null
      and confirmed_by is null and confirmation_report is null)
  )
);

create table public.invoice_import_items (
  id uuid primary key default gen_random_uuid(),
  invoice_import_id uuid not null references public.invoice_imports (id) on delete restrict,
  line_number integer not null,
  supplier_product_code text,
  description text not null,
  ean text,
  raw_unit text not null,
  normalized_unit public.unit_type,
  quantity numeric(18, 3) not null,
  unit_price numeric(18, 4) not null,
  total_amount numeric(18, 2) not null,
  resolved_product_id uuid references public.products (id) on delete restrict,
  match_source public.invoice_item_match_source not null default 'NONE',
  create_supplier_mapping boolean not null default false,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint invoice_import_items_line_unique unique (invoice_import_id, line_number),
  constraint invoice_import_items_line_positive check (line_number > 0),
  constraint invoice_import_items_code_not_blank check (
    supplier_product_code is null or btrim(supplier_product_code) <> ''
  ),
  constraint invoice_import_items_description_not_blank check (btrim(description) <> ''),
  constraint invoice_import_items_ean_format check (ean is null or ean ~ '^[0-9]{8,14}$'),
  constraint invoice_import_items_raw_unit_not_blank check (btrim(raw_unit) <> ''),
  constraint invoice_import_items_quantity_positive check (quantity > 0),
  constraint invoice_import_items_unit_price_nonnegative check (unit_price >= 0),
  constraint invoice_import_items_total_nonnegative check (total_amount >= 0),
  constraint invoice_import_items_errors_array check (jsonb_typeof(validation_errors) = 'array'),
  constraint invoice_import_items_mapping_requires_code check (
    not create_supplier_mapping or supplier_product_code is not null
  )
);

create unique index invoice_imports_file_hash_unique on public.invoice_imports (file_hash);
create unique index suppliers_document_digits_unique
on public.suppliers (regexp_replace(document, '[^0-9]', '', 'g'))
where document is not null;
create unique index invoice_imports_access_key_unique on public.invoice_imports (access_key)
where access_key is not null;
create unique index invoice_imports_fallback_identity_unique
on public.invoice_imports (supplier_document, invoice_number, coalesce(series, ''))
where access_key is null;
create unique index invoices_fallback_identity_unique
on public.invoices (supplier_id, invoice_number, coalesce(series, ''))
where access_key is null;
create index invoice_imports_created_by_status_idx
on public.invoice_imports (created_by, status, created_at desc);
create index invoice_import_items_import_idx
on public.invoice_import_items (invoice_import_id, line_number);
create index invoice_import_items_product_idx
on public.invoice_import_items (resolved_product_id)
where resolved_product_id is not null;

create trigger suppliers_prevent_delete
before delete on public.suppliers
for each statement execute function private.prevent_master_data_delete();

create trigger invoice_imports_set_updated_at
before update on public.invoice_imports
for each row execute function private.set_updated_at();

create trigger invoice_import_items_set_updated_at
before update on public.invoice_import_items
for each row execute function private.set_updated_at();

alter table public.invoice_imports enable row level security;
alter table public.invoice_imports force row level security;
alter table public.invoice_import_items enable row level security;
alter table public.invoice_import_items force row level security;

revoke all on public.invoice_imports, public.invoice_import_items from public, anon, authenticated;
grant select on public.invoice_imports, public.invoice_import_items to authenticated;

create policy invoice_imports_read_authorized
on public.invoice_imports for select to authenticated
using (
  (select private.has_role('ADMIN'))
  or ((select private.has_role('STOCK_OPERATOR')) and created_by = (select auth.uid()))
);

create policy invoice_import_items_read_authorized
on public.invoice_import_items for select to authenticated
using (
  exists (
    select 1
    from public.invoice_imports import
    where import.id = invoice_import_id
      and (
        (select private.has_role('ADMIN'))
        or ((select private.has_role('STOCK_OPERATOR')) and import.created_by = (select auth.uid()))
      )
  )
);

create function public.search_suppliers(
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
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  result jsonb;
begin
  if not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER']) then
    raise exception using errcode = '42501', message = 'authorized role is required';
  end if;
  with filtered as (
    select supplier.*
    from public.suppliers supplier
    where (p_is_active is null or supplier.is_active = p_is_active)
      and (
        nullif(btrim(p_search), '') is null
        or supplier.legal_name ilike '%' || btrim(p_search) || '%'
        or supplier.trade_name ilike '%' || btrim(p_search) || '%'
        or supplier.document ilike '%' || btrim(p_search) || '%'
      )
  ), paged as (
    select * from filtered
    order by legal_name, id
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'page', safe_page, 'page_size', safe_page_size,
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(paged.*) order by legal_name, id) from paged), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function public.get_supplier(p_supplier_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select to_jsonb(supplier.*) from public.suppliers supplier where supplier.id = p_supplier_id;
$$;

revoke all on function public.search_suppliers(text, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.get_supplier(uuid) from public, anon, authenticated;
grant execute on function public.search_suppliers(text, boolean, integer, integer) to authenticated;
grant execute on function public.get_supplier(uuid) to authenticated;

create function private.assert_nfe_actor(p_import_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']) then
    raise exception using errcode = '42501', message = 'invoice receiving role is required';
  end if;
  if p_import_id is not null
    and not private.has_role('ADMIN')
    and not exists (
      select 1 from public.invoice_imports i
      where i.id = p_import_id and i.created_by = actor_id
    )
  then
    raise exception using errcode = '42501', message = 'invoice import is not owned by current user';
  end if;
  return actor_id;
end;
$$;

create function public.stage_nfe_xml(
  p_file_hash text,
  p_original_filename text,
  p_original_file_path text,
  p_access_key text,
  p_invoice_number text,
  p_series text,
  p_issued_at timestamptz,
  p_supplier_document text,
  p_supplier_legal_name text,
  p_supplier_trade_name text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_nfe_actor();
  import_id uuid;
  matched_supplier_id uuid;
  item jsonb;
  product_id uuid;
  source public.invoice_item_match_source;
  item_errors jsonb;
  canonical_unit public.unit_type;
  all_ready boolean := true;
begin
  if p_file_hash !~ '^[0-9a-f]{64}$' or nullif(btrim(p_original_filename), '') is null
    or nullif(btrim(p_invoice_number), '') is null or p_issued_at is null
    or p_supplier_document !~ '^[0-9]{14}$'
    or nullif(btrim(p_supplier_legal_name), '') is null
    or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
  then
    raise exception using errcode = '22023', message = 'invalid staged NF-e payload';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nfe:file:' || p_file_hash, 0));
  select i.id into import_id
  from public.invoice_imports i
  where i.file_hash = p_file_hash
    and i.access_key is not distinct from p_access_key
    and i.invoice_number = btrim(p_invoice_number)
    and i.supplier_document = p_supplier_document
    and (i.created_by = actor_id or private.has_role('ADMIN'));
  if found then return import_id; end if;
  if exists (select 1 from public.invoice_imports i where i.file_hash = p_file_hash) then
    raise exception using errcode = '23505', message = 'file hash already belongs to another or different NF-e import';
  end if;
  if p_access_key is not null and exists (
    select 1 from public.invoices i where i.access_key = p_access_key
  ) then
    raise exception using errcode = '23505', message = 'NF-e access key was already confirmed';
  end if;

  select s.id into matched_supplier_id
  from public.suppliers s
  where regexp_replace(s.document, '[^0-9]', '', 'g') = p_supplier_document and s.is_active
  limit 1;
  if matched_supplier_id is null then all_ready := false; end if;

  insert into public.invoice_imports (
    file_hash, original_filename, original_file_path, access_key, invoice_number, series,
    issued_at, supplier_document, supplier_legal_name, supplier_trade_name,
    resolved_supplier_id, status, created_by
  ) values (
    p_file_hash, btrim(p_original_filename), nullif(btrim(p_original_file_path), ''),
    p_access_key, btrim(p_invoice_number), nullif(btrim(p_series), ''), p_issued_at,
    p_supplier_document, btrim(p_supplier_legal_name), nullif(btrim(p_supplier_trade_name), ''),
    matched_supplier_id, 'UPLOADED', actor_id
  ) returning id into import_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    product_id := null;
    source := 'NONE';
    item_errors := '[]'::jsonb;
    canonical_unit := case upper(btrim(item->>'unit'))
      when 'UN' then 'UN'::public.unit_type
      when 'UND' then 'UN'::public.unit_type
      when 'UNID' then 'UN'::public.unit_type
      when 'UNIDADE' then 'UN'::public.unit_type
      when 'KG' then 'KG'::public.unit_type
      when 'KGS' then 'KG'::public.unit_type
      when 'KILO' then 'KG'::public.unit_type
      when 'KILOGRAMA' then 'KG'::public.unit_type
      else null
    end;

    if matched_supplier_id is not null and nullif(btrim(item->>'supplierProductCode'), '') is not null then
      select mapping.product_id into product_id
      from public.supplier_product_mappings mapping
      join public.products product on product.id = mapping.product_id
        and product.is_active and product.unit = canonical_unit
      where mapping.supplier_id = matched_supplier_id
        and mapping.supplier_product_code = btrim(item->>'supplierProductCode');
      if found then source := 'SUPPLIER_PRODUCT_CODE'; end if;
    end if;
    if product_id is null and (item->>'ean') ~ '^[0-9]{8,14}$' then
      select min(product.id::text)::uuid into product_id
      from public.products product
      where product.ean = item->>'ean' and product.is_active and product.unit = canonical_unit
      having count(*) = 1;
      if product_id is not null then source := 'EAN'; end if;
    end if;
    if canonical_unit is null then
      item_errors := item_errors || jsonb_build_array(jsonb_build_object(
        'field', 'unit', 'value', item->>'unit', 'problem', 'Unidade não suportada',
        'suggestion', 'Mapeie manualmente para UN ou KG'
      ));
    end if;
    if product_id is null or canonical_unit is null then all_ready := false; end if;

    insert into public.invoice_import_items (
      invoice_import_id, line_number, supplier_product_code, description, ean,
      raw_unit, normalized_unit, quantity, unit_price, total_amount,
      resolved_product_id, match_source, validation_errors
    ) values (
      import_id, (item->>'lineNumber')::integer,
      nullif(btrim(item->>'supplierProductCode'), ''), btrim(item->>'description'),
      nullif(item->>'ean', ''), btrim(item->>'unit'), canonical_unit,
      (item->>'quantity')::numeric, (item->>'unitPrice')::numeric,
      (item->>'totalAmount')::numeric, product_id, source, item_errors
    );
  end loop;

  update public.invoice_imports
  set status = case
    when all_ready then 'READY'::public.invoice_import_status
    else 'PENDING_REVIEW'::public.invoice_import_status
  end
  where id = import_id;
  return import_id;
end;
$$;

create function public.review_nfe_import(
  p_invoice_import_id uuid,
  p_supplier_id uuid,
  p_item_resolutions jsonb
)
returns public.invoice_import_status
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_nfe_actor(p_invoice_import_id);
  resolution jsonb;
  selected_unit public.unit_type;
begin
  perform 1 from public.invoice_imports i
  where i.id = p_invoice_import_id and i.status in ('UPLOADED', 'PENDING_REVIEW', 'READY')
  for update;
  if not found then raise exception using errcode = '55000', message = 'invoice import cannot be reviewed'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.is_active) then
    raise exception using errcode = 'P0002', message = 'active supplier was not found';
  end if;
  if jsonb_typeof(p_item_resolutions) <> 'array' then
    raise exception using errcode = '22023', message = 'item resolutions must be an array';
  end if;

  update public.invoice_imports set resolved_supplier_id = p_supplier_id where id = p_invoice_import_id;
  for resolution in select value from jsonb_array_elements(p_item_resolutions)
  loop
    selected_unit := (resolution->>'unit')::public.unit_type;
    if not exists (
      select 1 from public.products p
      where p.id = (resolution->>'productId')::uuid and p.is_active and p.unit = selected_unit
    ) then
      raise exception using errcode = 'P0002', message = 'active product with compatible unit was not found';
    end if;
    update public.invoice_import_items
    set resolved_product_id = (resolution->>'productId')::uuid,
        normalized_unit = selected_unit,
        match_source = 'MANUAL',
        create_supplier_mapping = coalesce((resolution->>'createSupplierMapping')::boolean, false),
        validation_errors = '[]'::jsonb
    where id = (resolution->>'itemId')::uuid and invoice_import_id = p_invoice_import_id;
    if not found then raise exception using errcode = 'P0002', message = 'invoice import item was not found'; end if;
  end loop;

  if exists (
    select 1 from public.invoice_import_items item
    where item.invoice_import_id = p_invoice_import_id
      and (item.resolved_product_id is null or item.normalized_unit is null
        or jsonb_array_length(item.validation_errors) > 0)
  ) then
    update public.invoice_imports set status = 'PENDING_REVIEW' where id = p_invoice_import_id;
    return 'PENDING_REVIEW';
  end if;
  update public.invoice_imports set status = 'READY' where id = p_invoice_import_id;
  return 'READY';
end;
$$;

create function public.confirm_nfe_import(
  p_invoice_import_id uuid,
  p_destination_location_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_nfe_actor(p_invoice_import_id);
  staged public.invoice_imports%rowtype;
  item public.invoice_import_items%rowtype;
  invoice_id uuid;
  movement_count integer := 0;
  mapping_count integer := 0;
  report jsonb;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'idempotency_key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nfe:confirm:' || p_invoice_import_id::text, 0));
  select * into staged from public.invoice_imports where id = p_invoice_import_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'invoice import was not found'; end if;
  if staged.status = 'CONFIRMED' then
    if staged.confirmation_idempotency_key <> btrim(p_idempotency_key) then
      raise exception using errcode = '22000', message = 'invoice import was confirmed with a different idempotency key';
    end if;
    return staged.confirmation_report || jsonb_build_object('applied', false);
  end if;
  if staged.status <> 'READY' or staged.resolved_supplier_id is null then
    raise exception using errcode = '55000', message = 'invoice import is not ready';
  end if;
  if exists (
    select 1 from public.invoice_import_items i where i.invoice_import_id = staged.id
      and (i.resolved_product_id is null or i.normalized_unit is null
        or jsonb_array_length(i.validation_errors) > 0)
  ) then
    raise exception using errcode = '55000', message = 'invoice import has unresolved items';
  end if;
  if staged.access_key is not null and exists (
    select 1 from public.invoices i where i.access_key = staged.access_key
  ) then raise exception using errcode = '23505', message = 'NF-e access key was already confirmed'; end if;
  if staged.access_key is null and exists (
    select 1 from public.invoices i where i.supplier_id = staged.resolved_supplier_id
      and i.invoice_number = staged.invoice_number and coalesce(i.series, '') = coalesce(staged.series, '')
  ) then raise exception using errcode = '23505', message = 'invoice identity was already confirmed'; end if;

  insert into public.invoices (
    supplier_id, access_key, invoice_number, series, issued_at, imported_at,
    status, original_file_path, created_by
  ) values (
    staged.resolved_supplier_id, staged.access_key, staged.invoice_number, staged.series,
    staged.issued_at, statement_timestamp(), 'CONFIRMED', staged.original_file_path, actor_id
  ) returning id into invoice_id;

  for item in select * from public.invoice_import_items i
    where i.invoice_import_id = staged.id order by i.line_number
  loop
    insert into public.invoice_items (
      invoice_id, line_number, product_id, supplier_product_code, description,
      quantity, unit, unit_price, total_amount
    ) values (
      invoice_id, item.line_number, item.resolved_product_id, item.supplier_product_code,
      item.description, item.quantity, item.normalized_unit, item.unit_price, item.total_amount
    );
    if item.create_supplier_mapping and item.supplier_product_code is not null then
      if exists (
        select 1 from public.supplier_product_mappings existing
        where existing.supplier_id = staged.resolved_supplier_id
          and existing.supplier_product_code = item.supplier_product_code
          and existing.product_id <> item.resolved_product_id
      ) then
        raise exception using errcode = '23505', message = 'supplier product mapping conflicts with another product';
      end if;
      insert into public.supplier_product_mappings (supplier_id, supplier_product_code, product_id)
      values (staged.resolved_supplier_id, item.supplier_product_code, item.resolved_product_id)
      on conflict (supplier_id, supplier_product_code) do nothing;
      if found then mapping_count := mapping_count + 1; end if;
    end if;
    perform public.receive_stock(
      item.resolved_product_id, item.quantity, p_destination_location_id,
      'nfe:' || staged.id::text || ':item:' || item.id::text,
      invoice_id, 'Entrada por NF-e ' || staged.invoice_number
    );
    movement_count := movement_count + 1;
  end loop;

  report := jsonb_build_object(
    'invoiceId', invoice_id,
    'itemsCreated', movement_count,
    'movementsCreated', movement_count,
    'supplierMappingsCreated', mapping_count,
    'applied', true
  );
  update public.invoice_imports
  set status = 'CONFIRMED', confirmation_idempotency_key = btrim(p_idempotency_key),
      confirmed_invoice_id = invoice_id, confirmation_report = report,
      confirmed_at = statement_timestamp(), confirmed_by = actor_id
  where id = staged.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data, metadata)
  values (actor_id, 'NFE_CONFIRMED', 'invoice', invoice_id::text, report,
    jsonb_build_object('invoice_import_id', staged.id, 'idempotency_key', btrim(p_idempotency_key)));
  return report;
end;
$$;

revoke all on function private.assert_nfe_actor(uuid) from public, anon, authenticated;
revoke all on function private.is_valid_cnpj(text) from public, anon, authenticated;
revoke all on function private.is_valid_nfe_access_key(text) from public, anon, authenticated;
revoke all on function public.stage_nfe_xml(text, text, text, text, text, text, timestamptz, text, text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.review_nfe_import(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_nfe_import(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.stage_nfe_xml(text, text, text, text, text, text, timestamptz, text, text, text, jsonb)
to authenticated;
grant execute on function public.review_nfe_import(uuid, uuid, jsonb) to authenticated;
grant execute on function public.confirm_nfe_import(uuid, uuid, text) to authenticated;

do $storage$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'invoice-xml', 'invoice-xml', false, 10485760,
        array['application/xml', 'text/xml']
      )
      on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
    $sql$;
    execute 'drop policy if exists invoice_xml_read on storage.objects';
    execute 'drop policy if exists invoice_xml_insert on storage.objects';
    execute 'drop policy if exists invoice_xml_admin_delete on storage.objects';
    execute $policy$
      create policy invoice_xml_read on storage.objects for select to authenticated
      using (
        bucket_id = 'invoice-xml'
        and (
          (select private.has_role('ADMIN'))
          or (
            (select private.has_role('STOCK_OPERATOR'))
            and split_part(name, '/', 1) = (select auth.uid())::text
          )
        )
      )
    $policy$;
    execute $policy$
      create policy invoice_xml_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'invoice-xml'
        and (select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']))
        and split_part(name, '/', 1) = (select auth.uid())::text
      )
    $policy$;
    execute $policy$
      create policy invoice_xml_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'invoice-xml' and (select private.has_role('ADMIN')))
    $policy$;
  end if;
end;
$storage$;

comment on table public.invoice_imports is
  'Staging rastreável de NF-e XML; não representa documento fiscal confirmado nem altera estoque.';
comment on function public.confirm_nfe_import(uuid, uuid, text) is
  'Confirma NF-e, itens e entradas de estoque em uma única transação idempotente.';
