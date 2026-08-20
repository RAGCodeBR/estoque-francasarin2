create type public.invoice_import_source as enum ('XML', 'PDF');

alter table public.invoice_imports
  add column source_format public.invoice_import_source not null default 'XML',
  add column extraction_metadata jsonb not null default '{}'::jsonb,
  add column raw_extraction jsonb not null default '{}'::jsonb,
  add column suggested_supplier_id uuid references public.suppliers (id) on delete restrict,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles (id) on delete restrict,
  alter column invoice_number drop not null,
  alter column issued_at drop not null,
  alter column supplier_document drop not null,
  alter column supplier_legal_name drop not null,
  add constraint invoice_imports_extraction_metadata_object
    check (jsonb_typeof(extraction_metadata) = 'object'),
  add constraint invoice_imports_raw_extraction_object
    check (jsonb_typeof(raw_extraction) = 'object'),
  add constraint invoice_imports_review_consistent
    check ((reviewed_at is null) = (reviewed_by is null));

alter table public.invoice_import_items
  add column suggested_product_id uuid references public.products (id) on delete restrict,
  add column suggestion_source public.invoice_item_match_source not null default 'NONE',
  add column raw_item_data jsonb not null default '{}'::jsonb,
  add column ignored boolean not null default false,
  alter column description drop not null,
  alter column raw_unit drop not null,
  alter column quantity drop not null,
  alter column unit_price drop not null,
  alter column total_amount drop not null,
  add constraint invoice_import_items_raw_data_object
    check (jsonb_typeof(raw_item_data) = 'object');

create index invoice_imports_source_status_idx
on public.invoice_imports (source_format, status, created_at desc);
create index invoice_imports_suggested_supplier_idx
on public.invoice_imports (suggested_supplier_id)
where suggested_supplier_id is not null;
create index invoice_import_items_suggested_product_idx
on public.invoice_import_items (suggested_product_id)
where suggested_product_id is not null;

create function private.pdf_item_errors(
  p_description text,
  p_unit public.unit_type,
  p_quantity numeric,
  p_unit_price numeric,
  p_total_amount numeric,
  p_product_id uuid
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select
    case when nullif(btrim(p_description), '') is null
      then jsonb_build_array(jsonb_build_object(
        'field', 'description', 'problem', 'Descrição ausente',
        'suggestion', 'Informe a descrição após conferir o PDF'
      )) else '[]'::jsonb end
    || case when p_unit is null
      then jsonb_build_array(jsonb_build_object(
        'field', 'unit', 'problem', 'Unidade ausente ou não suportada',
        'suggestion', 'Selecione UN ou KG'
      )) else '[]'::jsonb end
    || case when p_quantity is null or p_quantity <= 0
      then jsonb_build_array(jsonb_build_object(
        'field', 'quantity', 'problem', 'Quantidade positiva não identificada',
        'suggestion', 'Informe a quantidade sem arredondamento implícito'
      )) else '[]'::jsonb end
    || case when p_unit_price is null or p_unit_price < 0
      then jsonb_build_array(jsonb_build_object(
        'field', 'unitPrice', 'problem', 'Valor unitário não identificado',
        'suggestion', 'Informe o valor unitário após conferir o PDF'
      )) else '[]'::jsonb end
    || case when p_total_amount is null or p_total_amount < 0
      then jsonb_build_array(jsonb_build_object(
        'field', 'totalAmount', 'problem', 'Valor total não identificado',
        'suggestion', 'Informe o valor total após conferir o PDF'
      )) else '[]'::jsonb end
    || case when p_product_id is null
      then jsonb_build_array(jsonb_build_object(
        'field', 'productId', 'problem', 'Produto não associado',
        'suggestion', 'Selecione um produto; descrição não cria associação automática'
      )) else '[]'::jsonb end;
$$;

create function public.stage_pdf_invoice(
  p_file_hash text,
  p_original_filename text,
  p_original_file_path text,
  p_header jsonb,
  p_items jsonb,
  p_extraction_metadata jsonb,
  p_raw_extraction jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_nfe_actor();
  import_id uuid;
  suggested_supplier uuid;
  suggested_product uuid;
  suggestion public.invoice_item_match_source;
  item jsonb;
  canonical_unit public.unit_type;
  parsed_quantity numeric(18, 3);
  parsed_unit_price numeric(18, 4);
  parsed_total numeric(18, 2);
  item_errors jsonb;
  header_errors jsonb := coalesce(p_header->'issues', '[]'::jsonb);
begin
  if p_file_hash !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_original_filename), '') is null
    or jsonb_typeof(p_header) <> 'object'
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) > 5000
    or jsonb_typeof(p_extraction_metadata) <> 'object'
    or jsonb_typeof(p_raw_extraction) <> 'object'
    or jsonb_typeof(header_errors) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid staged PDF payload';
  end if;
  if nullif(p_header->>'accessKey', '') is not null
    and not private.is_valid_nfe_access_key(p_header->>'accessKey')
  then raise exception using errcode = '22023', message = 'invalid NF-e access key extracted from PDF'; end if;
  if nullif(p_header->>'supplierDocument', '') is not null
    and not private.is_valid_cnpj(p_header->>'supplierDocument')
  then raise exception using errcode = '22023', message = 'invalid supplier CNPJ extracted from PDF'; end if;
  if nullif(p_header->>'issuedAt', '') is not null
    and (p_header->>'issuedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$'
  then raise exception using errcode = '22023', message = 'PDF issuedAt must include explicit date, time and timezone'; end if;

  perform pg_advisory_xact_lock(hashtextextended('invoice-pdf:file:' || p_file_hash, 0));
  select existing.id into import_id
  from public.invoice_imports existing
  where existing.file_hash = p_file_hash
    and existing.source_format = 'PDF'
    and (existing.created_by = actor_id or private.has_role('ADMIN'));
  if found then return import_id; end if;
  if exists (select 1 from public.invoice_imports existing where existing.file_hash = p_file_hash) then
    raise exception using errcode = '23505', message = 'file hash already belongs to another invoice import';
  end if;
  if nullif(p_header->>'accessKey', '') is not null and exists (
    select 1 from public.invoices invoice where invoice.access_key = p_header->>'accessKey'
  ) then raise exception using errcode = '23505', message = 'invoice access key was already confirmed'; end if;

  if nullif(p_header->>'supplierDocument', '') is not null then
    select supplier.id into suggested_supplier
    from public.suppliers supplier
    where regexp_replace(supplier.document, '[^0-9]', '', 'g') = p_header->>'supplierDocument'
      and supplier.is_active
    limit 1;
  end if;

  insert into public.invoice_imports (
    file_hash, original_filename, original_file_path, access_key, invoice_number, series,
    issued_at, supplier_document, supplier_legal_name, suggested_supplier_id,
    status, validation_errors, source_format, extraction_metadata, raw_extraction, created_by
  ) values (
    p_file_hash, btrim(p_original_filename), nullif(btrim(p_original_file_path), ''),
    nullif(p_header->>'accessKey', ''), nullif(btrim(p_header->>'invoiceNumber'), ''),
    nullif(btrim(p_header->>'series'), ''),
    case when nullif(p_header->>'issuedAt', '') is null then null
      else (p_header->>'issuedAt')::timestamptz end,
    nullif(p_header->>'supplierDocument', ''),
    nullif(btrim(p_header->>'supplierLegalName'), ''), suggested_supplier,
    'PENDING_REVIEW', header_errors, 'PDF', p_extraction_metadata, p_raw_extraction, actor_id
  ) returning id into import_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    suggested_product := null;
    suggestion := 'NONE';
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
    parsed_quantity := case when (item->>'quantity') ~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$'
      then (item->>'quantity')::numeric else null end;
    parsed_unit_price := case when (item->>'unitPrice') ~ '^(0|[1-9][0-9]{0,13})\.[0-9]{4}$'
      then (item->>'unitPrice')::numeric else null end;
    parsed_total := case when (item->>'totalAmount') ~ '^(0|[1-9][0-9]{0,15})\.[0-9]{2}$'
      then (item->>'totalAmount')::numeric else null end;

    if suggested_supplier is not null and nullif(btrim(item->>'supplierProductCode'), '') is not null then
      select mapping.product_id into suggested_product
      from public.supplier_product_mappings mapping
      join public.products product on product.id = mapping.product_id
        and product.is_active and product.unit = canonical_unit
      where mapping.supplier_id = suggested_supplier
        and mapping.supplier_product_code = btrim(item->>'supplierProductCode');
      if found then suggestion := 'SUPPLIER_PRODUCT_CODE'; end if;
    end if;
    if suggested_product is null and private.is_valid_ean(item->>'ean') then
      select min(product.id::text)::uuid into suggested_product
      from public.products product
      where product.ean = item->>'ean' and product.is_active and product.unit = canonical_unit
      having count(*) = 1;
      if suggested_product is not null then suggestion := 'EAN'; end if;
    end if;
    item_errors := private.pdf_item_errors(
      nullif(btrim(item->>'description'), ''), canonical_unit, parsed_quantity,
      parsed_unit_price, parsed_total, null
    );
    insert into public.invoice_import_items (
      invoice_import_id, line_number, supplier_product_code, description, ean,
      raw_unit, normalized_unit, quantity, unit_price, total_amount,
      suggested_product_id, suggestion_source, validation_errors, raw_item_data
    ) values (
      import_id, (item->>'lineNumber')::integer,
      nullif(btrim(item->>'supplierProductCode'), ''), nullif(btrim(item->>'description'), ''),
      case when private.is_valid_ean(item->>'ean') then item->>'ean' else null end,
      nullif(btrim(item->>'unit'), ''), canonical_unit, parsed_quantity,
      parsed_unit_price, parsed_total, suggested_product, suggestion, item_errors, item
    );
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data, metadata)
  values (
    actor_id, 'PDF_INVOICE_STAGED', 'invoice_import', import_id::text,
    jsonb_build_object('status', 'PENDING_REVIEW', 'source_format', 'PDF'),
    jsonb_build_object('file_hash', p_file_hash, 'items_extracted', jsonb_array_length(p_items))
  );
  return import_id;
end;
$$;

create function public.review_pdf_invoice(
  p_invoice_import_id uuid,
  p_header jsonb,
  p_item_reviews jsonb
)
returns public.invoice_import_status
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := private.assert_nfe_actor(p_invoice_import_id);
  review jsonb;
  item_id uuid;
  selected_unit public.unit_type;
  selected_product uuid;
  selected_description text;
  selected_code text;
  selected_ean text;
  selected_quantity numeric(18, 3);
  selected_unit_price numeric(18, 4);
  selected_total numeric(18, 2);
  line_value integer;
  header_errors jsonb := '[]'::jsonb;
begin
  perform 1 from public.invoice_imports import
  where import.id = p_invoice_import_id and import.source_format = 'PDF'
    and import.status in ('UPLOADED', 'PENDING_REVIEW', 'READY')
  for update;
  if not found then raise exception using errcode = '55000', message = 'PDF invoice import cannot be reviewed'; end if;
  if jsonb_typeof(p_header) <> 'object' or jsonb_typeof(p_item_reviews) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid PDF review payload';
  end if;

  if p_header ? 'supplierId' then
    if not exists (
      select 1 from public.suppliers supplier
      where supplier.id = (p_header->>'supplierId')::uuid and supplier.is_active
    ) then raise exception using errcode = 'P0002', message = 'active supplier was not found'; end if;
    update public.invoice_imports set resolved_supplier_id = (p_header->>'supplierId')::uuid
    where id = p_invoice_import_id;
  end if;
  if p_header ? 'accessKey' and nullif(p_header->>'accessKey', '') is not null
    and not private.is_valid_nfe_access_key(p_header->>'accessKey')
  then raise exception using errcode = '22023', message = 'invalid reviewed NF-e access key'; end if;
  if p_header ? 'issuedAt' and nullif(p_header->>'issuedAt', '') is not null
    and (p_header->>'issuedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$'
  then raise exception using errcode = '22023', message = 'reviewed issuedAt must include explicit date, time and timezone'; end if;

  update public.invoice_imports
  set access_key = case when p_header ? 'accessKey' then nullif(p_header->>'accessKey', '') else access_key end,
      invoice_number = case when p_header ? 'invoiceNumber' then nullif(btrim(p_header->>'invoiceNumber'), '') else invoice_number end,
      series = case when p_header ? 'series' then nullif(btrim(p_header->>'series'), '') else series end,
      issued_at = case when p_header ? 'issuedAt' then (p_header->>'issuedAt')::timestamptz else issued_at end,
      reviewed_at = statement_timestamp(), reviewed_by = actor_id
  where id = p_invoice_import_id;

  for review in select value from jsonb_array_elements(p_item_reviews)
  loop
    if nullif(review->>'itemId', '') is not null and not exists (
      select 1 from public.invoice_import_items existing
      where existing.id = (review->>'itemId')::uuid
        and existing.invoice_import_id = p_invoice_import_id
    ) then
      raise exception using errcode = 'P0002', message = 'PDF invoice item was not found in this import';
    end if;
    item_id := case when nullif(review->>'itemId', '') is null then gen_random_uuid()
      else (review->>'itemId')::uuid end;
    if coalesce((review->>'ignored')::boolean, false) then
      update public.invoice_import_items set ignored = true, validation_errors = '[]'::jsonb
      where id = item_id and invoice_import_id = p_invoice_import_id;
      if not found then raise exception using errcode = 'P0002', message = 'PDF invoice item was not found'; end if;
      continue;
    end if;

    select
      coalesce((review->>'lineNumber')::integer, existing.line_number),
      coalesce(nullif(btrim(review->>'description'), ''), existing.description),
      case when review ? 'supplierProductCode' then nullif(btrim(review->>'supplierProductCode'), '') else existing.supplier_product_code end,
      case when review ? 'ean' then nullif(review->>'ean', '') else existing.ean end,
      coalesce((review->>'unit')::public.unit_type, existing.normalized_unit),
      coalesce((review->>'productId')::uuid, existing.resolved_product_id),
      coalesce((review->>'quantity')::numeric, existing.quantity),
      coalesce((review->>'unitPrice')::numeric, existing.unit_price),
      coalesce((review->>'totalAmount')::numeric, existing.total_amount)
    into line_value, selected_description, selected_code, selected_ean, selected_unit,
      selected_product, selected_quantity, selected_unit_price, selected_total
    from (select 1) sentinel
    left join public.invoice_import_items existing
      on existing.id = item_id and existing.invoice_import_id = p_invoice_import_id;

    if line_value is null or line_value <= 0 then
      raise exception using errcode = '22023', message = 'positive lineNumber is required';
    end if;
    if selected_ean is not null and not private.is_valid_ean(selected_ean) then
      raise exception using errcode = '22023', message = 'reviewed EAN is invalid';
    end if;
    if selected_quantity is not null and (
      selected_quantity <= 0 or selected_quantity <> round(selected_quantity, 3)
      or selected_quantity > 999999999999999.999
    ) then raise exception using errcode = '22023', message = 'reviewed quantity must fit NUMERIC(18,3) and be positive'; end if;
    if selected_unit_price is not null and (
      selected_unit_price < 0 or selected_unit_price <> round(selected_unit_price, 4)
      or selected_unit_price > 99999999999999.9999
    ) then raise exception using errcode = '22023', message = 'reviewed unit price must fit NUMERIC(18,4)'; end if;
    if selected_total is not null and (
      selected_total < 0 or selected_total <> round(selected_total, 2)
      or selected_total > 9999999999999999.99
    ) then raise exception using errcode = '22023', message = 'reviewed total must fit NUMERIC(18,2)'; end if;
    if selected_product is not null and not exists (
      select 1 from public.products product
      where product.id = selected_product and product.is_active and product.unit = selected_unit
    ) then raise exception using errcode = 'P0002', message = 'active product with compatible unit was not found'; end if;
    if coalesce((review->>'createSupplierMapping')::boolean, false) and selected_code is null then
      raise exception using errcode = '22023', message = 'supplier product code is required to create mapping';
    end if;

    insert into public.invoice_import_items (
      id, invoice_import_id, line_number, supplier_product_code, description, ean,
      raw_unit, normalized_unit, quantity, unit_price, total_amount,
      resolved_product_id, match_source, create_supplier_mapping, validation_errors,
      raw_item_data, ignored
    ) values (
      item_id, p_invoice_import_id, line_value, selected_code, selected_description, selected_ean,
      selected_unit::text, selected_unit, selected_quantity, selected_unit_price, selected_total,
      selected_product, 'MANUAL', coalesce((review->>'createSupplierMapping')::boolean, false),
      private.pdf_item_errors(selected_description, selected_unit, selected_quantity,
        selected_unit_price, selected_total, selected_product),
      jsonb_build_object('reviewed', true), false
    )
    on conflict (id) do update set
      line_number = excluded.line_number,
      supplier_product_code = excluded.supplier_product_code,
      description = excluded.description,
      ean = excluded.ean,
      raw_unit = excluded.raw_unit,
      normalized_unit = excluded.normalized_unit,
      quantity = excluded.quantity,
      unit_price = excluded.unit_price,
      total_amount = excluded.total_amount,
      resolved_product_id = excluded.resolved_product_id,
      match_source = 'MANUAL',
      create_supplier_mapping = excluded.create_supplier_mapping,
      validation_errors = excluded.validation_errors,
      ignored = false;
  end loop;

  select
    case when import.resolved_supplier_id is null then
      jsonb_build_array(jsonb_build_object('field', 'supplierId', 'problem', 'Fornecedor não selecionado', 'suggestion', 'Selecione um fornecedor ativo'))
    else '[]'::jsonb end
    || case when nullif(btrim(import.invoice_number), '') is null then
      jsonb_build_array(jsonb_build_object('field', 'invoiceNumber', 'problem', 'Número da nota ausente', 'suggestion', 'Informe o número após conferir o PDF'))
    else '[]'::jsonb end
    || case when import.issued_at is null then
      jsonb_build_array(jsonb_build_object('field', 'issuedAt', 'problem', 'Data de emissão ausente', 'suggestion', 'Informe a data sem inventar valores'))
    else '[]'::jsonb end
  into header_errors
  from public.invoice_imports import where import.id = p_invoice_import_id;

  update public.invoice_imports set validation_errors = header_errors where id = p_invoice_import_id;
  if jsonb_array_length(header_errors) > 0
    or not exists (
      select 1 from public.invoice_import_items item
      where item.invoice_import_id = p_invoice_import_id and not item.ignored
    )
    or exists (
      select 1 from public.invoice_import_items item
      where item.invoice_import_id = p_invoice_import_id and not item.ignored
        and jsonb_array_length(item.validation_errors) > 0
    )
  then
    update public.invoice_imports set status = 'PENDING_REVIEW' where id = p_invoice_import_id;
    return 'PENDING_REVIEW';
  end if;
  update public.invoice_imports set status = 'READY' where id = p_invoice_import_id;
  return 'READY';
end;
$$;

alter function public.confirm_nfe_import(uuid, uuid, text)
rename to confirm_invoice_import_core;

revoke all on function public.confirm_invoice_import_core(uuid, uuid, text)
from public, anon, authenticated;

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
begin
  if not exists (
    select 1 from public.invoice_imports import
    where import.id = p_invoice_import_id and import.source_format = 'XML'
  ) then raise exception using errcode = '55000', message = 'XML invoice import was not found'; end if;
  return public.confirm_invoice_import_core(
    p_invoice_import_id, p_destination_location_id, p_idempotency_key
  );
end;
$$;

create function public.confirm_pdf_invoice(
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
  perform pg_advisory_xact_lock(hashtextextended('pdf:confirm:' || p_invoice_import_id::text, 0));
  select * into staged from public.invoice_imports
  where id = p_invoice_import_id and source_format = 'PDF' for update;
  if not found then raise exception using errcode = 'P0002', message = 'PDF invoice import was not found'; end if;
  if staged.status = 'CONFIRMED' then
    if staged.confirmation_idempotency_key <> btrim(p_idempotency_key) then
      raise exception using errcode = '22000', message = 'PDF invoice import was confirmed with a different idempotency key';
    end if;
    return staged.confirmation_report || jsonb_build_object('applied', false);
  end if;
  if staged.status <> 'READY' or staged.reviewed_at is null or staged.reviewed_by is null
    or staged.resolved_supplier_id is null or staged.invoice_number is null or staged.issued_at is null
  then raise exception using errcode = '55000', message = 'PDF invoice import requires complete human review'; end if;
  if not exists (
    select 1 from public.invoice_import_items i
    where i.invoice_import_id = staged.id and not i.ignored
  ) or exists (
    select 1 from public.invoice_import_items i
    where i.invoice_import_id = staged.id and not i.ignored
      and (i.resolved_product_id is null or i.description is null or i.normalized_unit is null
        or i.quantity is null or i.unit_price is null or i.total_amount is null
        or jsonb_array_length(i.validation_errors) > 0)
  ) then raise exception using errcode = '55000', message = 'PDF invoice import has unresolved items'; end if;
  if staged.access_key is not null and exists (
    select 1 from public.invoices i where i.access_key = staged.access_key
  ) then raise exception using errcode = '23505', message = 'invoice access key was already confirmed'; end if;
  if staged.access_key is null and exists (
    select 1 from public.invoices i where i.supplier_id = staged.resolved_supplier_id
      and i.invoice_number = staged.invoice_number
      and coalesce(i.series, '') = coalesce(staged.series, '')
  ) then raise exception using errcode = '23505', message = 'invoice identity was already confirmed'; end if;

  insert into public.invoices (
    supplier_id, access_key, invoice_number, series, issued_at, imported_at,
    status, original_file_path, created_by
  ) values (
    staged.resolved_supplier_id, staged.access_key, staged.invoice_number, staged.series,
    staged.issued_at, statement_timestamp(), 'CONFIRMED', staged.original_file_path, actor_id
  ) returning id into invoice_id;

  for item in select * from public.invoice_import_items i
    where i.invoice_import_id = staged.id and not i.ignored order by i.line_number
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
      ) then raise exception using errcode = '23505', message = 'supplier product mapping conflicts with another product'; end if;
      insert into public.supplier_product_mappings (supplier_id, supplier_product_code, product_id)
      values (staged.resolved_supplier_id, item.supplier_product_code, item.resolved_product_id)
      on conflict (supplier_id, supplier_product_code) do nothing;
      if found then mapping_count := mapping_count + 1; end if;
    end if;
    perform public.receive_stock(
      item.resolved_product_id, item.quantity, p_destination_location_id,
      'pdf:' || staged.id::text || ':item:' || item.id::text,
      invoice_id, 'Entrada por PDF revisado da NF ' || staged.invoice_number
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
  values (
    actor_id, 'PDF_INVOICE_CONFIRMED', 'invoice', invoice_id::text, report,
    jsonb_build_object('invoice_import_id', staged.id, 'idempotency_key', btrim(p_idempotency_key))
  );
  return report;
end;
$$;

create function public.get_invoice_import_preview(p_invoice_import_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'import', to_jsonb(import.*),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item.*) order by item.line_number)
      from public.invoice_import_items item
      where item.invoice_import_id = import.id
    ), '[]'::jsonb)
  )
  from public.invoice_imports import
  where import.id = p_invoice_import_id;
$$;

revoke all on function private.pdf_item_errors(text, public.unit_type, numeric, numeric, numeric, uuid)
from public, anon, authenticated;
revoke all on function public.stage_pdf_invoice(text, text, text, jsonb, jsonb, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.review_pdf_invoice(uuid, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.confirm_nfe_import(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.confirm_pdf_invoice(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.get_invoice_import_preview(uuid)
from public, anon, authenticated;
grant execute on function public.stage_pdf_invoice(text, text, text, jsonb, jsonb, jsonb, jsonb)
to authenticated;
grant execute on function public.review_pdf_invoice(uuid, jsonb, jsonb)
to authenticated;
grant execute on function public.confirm_nfe_import(uuid, uuid, text)
to authenticated;
grant execute on function public.confirm_pdf_invoice(uuid, uuid, text)
to authenticated;
grant execute on function public.get_invoice_import_preview(uuid)
to authenticated;

do $storage$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('invoice-pdf', 'invoice-pdf', false, 15728640, array['application/pdf'])
      on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
    $sql$;
    execute 'drop policy if exists invoice_pdf_read on storage.objects';
    execute 'drop policy if exists invoice_pdf_insert on storage.objects';
    execute 'drop policy if exists invoice_pdf_admin_delete on storage.objects';
    execute $policy$
      create policy invoice_pdf_read on storage.objects for select to authenticated
      using (
        bucket_id = 'invoice-pdf'
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
      create policy invoice_pdf_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'invoice-pdf'
        and (select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR']))
        and split_part(name, '/', 1) = (select auth.uid())::text
      )
    $policy$;
    execute $policy$
      create policy invoice_pdf_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'invoice-pdf' and (select private.has_role('ADMIN')))
    $policy$;
  end if;
end;
$storage$;

comment on function public.stage_pdf_invoice(text, text, text, jsonb, jsonb, jsonb, jsonb) is
  'Cria staging assistido de PDF; extração nunca resolve entidades nem movimenta estoque.';
comment on function public.review_pdf_invoice(uuid, jsonb, jsonb) is
  'Registra revisão humana de cabeçalho e itens de PDF e mantém PENDING_REVIEW enquanto incompleto.';
comment on function public.confirm_pdf_invoice(uuid, uuid, text) is
  'Confirma PDF revisado usando a mesma transação idempotente de nota, itens e receive_stock.';
