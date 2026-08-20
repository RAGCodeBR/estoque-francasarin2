begin;

create function private.audit_payload_is_safe(payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  entry record;
  element jsonb;
  scalar_value text;
  normalized_key text;
begin
  if payload is null then
    return true;
  end if;

  case jsonb_typeof(payload)
    when 'object' then
      for entry in select key, value from jsonb_each(payload)
      loop
        normalized_key := lower(btrim(entry.key));
        if normalized_key = any(array[
          'password', 'passwd', 'password_hash', 'token', 'access_token', 'refresh_token',
          'secret', 'secret_key', 'service_role', 'service_role_key', 'authorization',
          'cookie', 'database_url', 'connection_string', 'jwt', 'jwt_secret',
          'private_key', 'client_secret', 'api_secret'
        ]) then
          return false;
        end if;
        if not private.audit_payload_is_safe(entry.value) then
          return false;
        end if;
      end loop;
    when 'array' then
      for element in select value from jsonb_array_elements(payload)
      loop
        if not private.audit_payload_is_safe(element) then
          return false;
        end if;
      end loop;
    when 'string' then
      scalar_value := payload #>> '{}';
      if scalar_value ~* '(sb_secret_|service_role|postgres(ql)?://|bearer[[:space:]]+eyj|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)' then
        return false;
      end if;
    else
      null;
  end case;

  return true;
end;
$$;

revoke all on function private.audit_payload_is_safe(jsonb)
from public, anon, authenticated;

alter table public.audit_logs
  add constraint audit_logs_old_data_no_secrets check (private.audit_payload_is_safe(old_data)),
  add constraint audit_logs_new_data_no_secrets check (private.audit_payload_is_safe(new_data)),
  add constraint audit_logs_metadata_no_secrets check (private.audit_payload_is_safe(metadata));

create index audit_logs_action_created_at_idx
  on public.audit_logs (action, created_at desc, id desc);
create index audit_logs_entity_created_at_idx
  on public.audit_logs (entity_type, entity_id, created_at desc, id desc);
create index audit_logs_actor_created_at_idx
  on public.audit_logs (actor_id, created_at desc, id desc)
  where actor_id is not null;
create index audit_logs_request_created_at_idx
  on public.audit_logs (request_id, created_at desc, id desc)
  where request_id is not null;

create function private.normalize_stock_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  movement public.stock_movements%rowtype;
begin
  if new.action = 'STOCK_MOVEMENT_CREATED'
    and new.entity_type = 'stock_movement'
    and new.entity_id is not null
  then
    select stock_movement.*
    into movement
    from public.stock_movements stock_movement
    where stock_movement.id::text = new.entity_id;

    if found then
      new.action := case movement.movement_type
        when 'ADJUSTMENT_POSITIVE' then 'STOCK_ADJUSTMENT_CREATED'
        when 'ADJUSTMENT_NEGATIVE' then 'STOCK_ADJUSTMENT_CREATED'
        when 'LOSS' then 'STOCK_LOSS_MOVEMENT_CREATED'
        when 'MIGRATION_OPENING_BALANCE' then 'MIGRATION_OPENING_BALANCE_CREATED'
        else new.action
      end;
      new.metadata := new.metadata || jsonb_strip_nulls(jsonb_build_object(
        'stock_movement_id', movement.id,
        'movement_type', movement.movement_type::text,
        'import_batch_id', movement.import_batch_id,
        'invoice_id', movement.invoice_id,
        'source_location_id', movement.source_location_id,
        'destination_location_id', movement.destination_location_id
      ));
    end if;
  end if;

  if not private.audit_payload_is_safe(new.old_data)
    or not private.audit_payload_is_safe(new.new_data)
    or not private.audit_payload_is_safe(new.metadata)
  then
    raise exception using
      errcode = '22023',
      message = 'audit payload contains a forbidden credential field or secret pattern';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_stock_audit_event()
from public, anon, authenticated;

create trigger audit_logs_normalize_and_reject_secrets
before insert on public.audit_logs
for each row execute function private.normalize_stock_audit_event();

create function private.audit_master_data_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := (select auth.uid());
  entity_type_value text := tg_argv[0];
  old_snapshot jsonb;
  new_snapshot jsonb;
  action_value text;
begin
  if tg_table_name = 'products' then
    old_snapshot := case when tg_op = 'UPDATE' then jsonb_build_object(
      'id', old.id, 'name', old.name, 'sku', old.sku, 'ean', old.ean,
      'product_type', old.product_type, 'unit', old.unit, 'category_id', old.category_id,
      'minimum_quantity', old.minimum_quantity::text, 'is_active', old.is_active
    ) else null end;
    new_snapshot := jsonb_build_object(
      'id', new.id, 'name', new.name, 'sku', new.sku, 'ean', new.ean,
      'product_type', new.product_type, 'unit', new.unit, 'category_id', new.category_id,
      'minimum_quantity', new.minimum_quantity::text, 'is_active', new.is_active
    );
  elsif tg_table_name = 'categories' then
    old_snapshot := case when tg_op = 'UPDATE' then jsonb_build_object(
      'id', old.id, 'name', old.name, 'description', old.description, 'is_active', old.is_active
    ) else null end;
    new_snapshot := jsonb_build_object(
      'id', new.id, 'name', new.name, 'description', new.description, 'is_active', new.is_active
    );
  elsif tg_table_name = 'locations' then
    old_snapshot := case when tg_op = 'UPDATE' then jsonb_build_object(
      'id', old.id, 'name', old.name, 'description', old.description,
      'location_type', old.location_type, 'is_active', old.is_active
    ) else null end;
    new_snapshot := jsonb_build_object(
      'id', new.id, 'name', new.name, 'description', new.description,
      'location_type', new.location_type, 'is_active', new.is_active
    );
  elsif tg_table_name = 'suppliers' then
    old_snapshot := case when tg_op = 'UPDATE' then jsonb_build_object(
      'id', old.id, 'legal_name', old.legal_name, 'trade_name', old.trade_name,
      'document', old.document, 'is_active', old.is_active
    ) else null end;
    new_snapshot := jsonb_build_object(
      'id', new.id, 'legal_name', new.legal_name, 'trade_name', new.trade_name,
      'document', new.document, 'is_active', new.is_active
    );
  else
    raise exception using errcode = '22023', message = 'unsupported audited master data table';
  end if;

  if tg_op = 'INSERT' then
    action_value := upper(entity_type_value) || '_CREATED';
  elsif old.is_active and not new.is_active then
    action_value := upper(entity_type_value) || '_INACTIVATED';
  elsif not old.is_active and new.is_active then
    action_value := upper(entity_type_value) || '_REACTIVATED';
  else
    action_value := upper(entity_type_value) || '_UPDATED';
  end if;

  if tg_op = 'UPDATE' and old_snapshot = new_snapshot then
    return new;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_data, new_data, metadata
  ) values (
    actor_id,
    action_value,
    entity_type_value,
    new.id::text,
    old_snapshot,
    new_snapshot,
    jsonb_build_object('source_table', tg_table_schema || '.' || tg_table_name)
  );

  return new;
end;
$$;

revoke all on function private.audit_master_data_change()
from public, anon, authenticated;

create trigger products_write_audit
after insert or update on public.products
for each row execute function private.audit_master_data_change('product');
create trigger categories_write_audit
after insert or update on public.categories
for each row execute function private.audit_master_data_change('category');
create trigger locations_write_audit
after insert or update on public.locations
for each row execute function private.audit_master_data_change('location');
create trigger suppliers_write_audit
after insert or update on public.suppliers
for each row execute function private.audit_master_data_change('supplier');

create function private.audit_invoice_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := coalesce((select auth.uid()), new.created_by);
  old_snapshot jsonb;
  new_snapshot jsonb;
  action_value text;
begin
  old_snapshot := case when tg_op = 'UPDATE' then jsonb_build_object(
    'id', old.id, 'supplier_id', old.supplier_id, 'invoice_number', old.invoice_number,
    'series', old.series, 'issued_at', old.issued_at, 'imported_at', old.imported_at,
    'status', old.status, 'original_file_path', old.original_file_path
  ) else null end;
  new_snapshot := jsonb_build_object(
    'id', new.id, 'supplier_id', new.supplier_id, 'invoice_number', new.invoice_number,
    'series', new.series, 'issued_at', new.issued_at, 'imported_at', new.imported_at,
    'status', new.status, 'original_file_path', new.original_file_path
  );

  if tg_op = 'INSERT' then
    action_value := 'INVOICE_CREATED';
  elsif new.status = 'CONFIRMED' and old.status <> 'CONFIRMED' then
    action_value := 'INVOICE_CONFIRMED';
  elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
    action_value := 'INVOICE_CANCELLED';
  else
    action_value := 'INVOICE_UPDATED';
  end if;

  if tg_op = 'UPDATE' and old_snapshot = new_snapshot then
    return new;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_data, new_data, metadata
  ) values (
    actor_id, action_value, 'invoice', new.id::text, old_snapshot, new_snapshot,
    jsonb_build_object('source_table', 'public.invoices')
  );
  return new;
end;
$$;

revoke all on function private.audit_invoice_change()
from public, anon, authenticated;

create trigger invoices_write_audit
after insert or update on public.invoices
for each row execute function private.audit_invoice_change();

create function private.audit_import_batch_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := coalesce((select auth.uid()), new.confirmed_by, new.created_by);
  action_value text;
  old_snapshot jsonb;
  new_snapshot jsonb;
  result_value jsonb;
begin
  old_snapshot := case when tg_op = 'UPDATE' then jsonb_build_object(
    'status', old.status, 'total_rows', old.total_rows, 'valid_rows', old.valid_rows,
    'invalid_rows', old.invalid_rows, 'confirmed_at', old.confirmed_at,
    'confirmed_by', old.confirmed_by
  ) else null end;
  new_snapshot := jsonb_build_object(
    'status', new.status, 'total_rows', new.total_rows, 'valid_rows', new.valid_rows,
    'invalid_rows', new.invalid_rows, 'confirmed_at', new.confirmed_at,
    'confirmed_by', new.confirmed_by
  );
  result_value := coalesce(
    new.confirmation_report,
    new.dry_run_summary,
    jsonb_build_object('valid_rows', new.valid_rows, 'invalid_rows', new.invalid_rows)
  );

  if tg_op = 'INSERT' then
    action_value := 'IMPORT_BATCH_CREATED';
  elsif new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
    action_value := 'IMPORT_BATCH_CONFIRMED';
  elsif new.status is distinct from old.status then
    action_value := 'IMPORT_BATCH_STATUS_CHANGED';
  else
    action_value := 'IMPORT_BATCH_UPDATED';
  end if;

  if tg_op = 'UPDATE' and old_snapshot = new_snapshot then
    return new;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, request_id, old_data, new_data, metadata
  ) values (
    actor_id,
    action_value,
    'import_batch',
    new.id::text,
    new.id,
    old_snapshot,
    new_snapshot,
    jsonb_build_object(
      'import_batch_id', new.id,
      'file', new.original_filename,
      'file_hash', new.file_hash,
      'source_type', new.source_type,
      'source_name', new.source_name,
      'user_id', actor_id,
      'event_at', coalesce(new.confirmed_at, statement_timestamp()),
      'total_rows', new.total_rows,
      'result', result_value
    )
  );
  return new;
end;
$$;

revoke all on function private.audit_import_batch_change()
from public, anon, authenticated;

create trigger import_batches_write_audit
after insert or update on public.import_batches
for each row execute function private.audit_import_batch_change();

create function private.audit_invoice_import_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := coalesce((select auth.uid()), new.confirmed_by, new.created_by);
  action_value text;
begin
  if tg_op = 'INSERT' then
    action_value := 'INVOICE_IMPORT_CREATED';
  elsif new.status = 'CONFIRMED' and old.status <> 'CONFIRMED' then
    action_value := 'INVOICE_IMPORT_CONFIRMED';
  elsif new.status is distinct from old.status then
    action_value := 'INVOICE_IMPORT_STATUS_CHANGED';
  else
    return new;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, request_id, old_data, new_data, metadata
  ) values (
    actor_id,
    action_value,
    'invoice_import',
    new.id::text,
    new.id,
    case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) else null end,
    jsonb_build_object(
      'status', new.status,
      'source_format', new.source_format,
      'confirmed_invoice_id', new.confirmed_invoice_id
    ),
    jsonb_build_object(
      'file', new.original_filename,
      'file_hash', new.file_hash,
      'user_id', actor_id,
      'event_at', coalesce(new.confirmed_at, statement_timestamp()),
      'result', coalesce(new.confirmation_report, jsonb_build_object(
        'validation_error_count', jsonb_array_length(new.validation_errors)
      ))
    )
  );
  return new;
end;
$$;

revoke all on function private.audit_invoice_import_change()
from public, anon, authenticated;

create trigger invoice_imports_write_audit
after insert or update on public.invoice_imports
for each row execute function private.audit_invoice_import_change();

create function public.search_audit_logs(
  p_action text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_actor_id uuid default null,
  p_request_id uuid default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  action_value text := nullif(btrim(p_action), '');
  entity_type_value text := nullif(btrim(p_entity_type), '');
  entity_id_value text := nullif(btrim(p_entity_id), '');
  row_offset integer;
begin
  if p_page is null or p_page < 1 then
    raise exception using errcode = '22023', message = 'page must be a positive integer';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'page_size must be between 1 and 100';
  end if;
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    raise exception using errcode = '22023', message = 'created_from cannot be after created_to';
  end if;
  row_offset := (p_page - 1) * p_page_size;

  return (
    with filtered as materialized (
      select audit.*
      from public.audit_logs audit
      where (action_value is null or audit.action = action_value)
        and (entity_type_value is null or audit.entity_type = entity_type_value)
        and (entity_id_value is null or audit.entity_id = entity_id_value)
        and (p_actor_id is null or audit.actor_id = p_actor_id)
        and (p_request_id is null or audit.request_id = p_request_id)
        and (p_created_from is null or audit.created_at >= p_created_from)
        and (p_created_to is null or audit.created_at <= p_created_to)
    ),
    paged as (
      select filtered.*
      from filtered
      order by filtered.created_at desc, filtered.id desc
      limit p_page_size offset row_offset
    )
    select jsonb_build_object(
      'page', p_page,
      'page_size', p_page_size,
      'total', (select count(*) from filtered),
      'items', coalesce((
        select jsonb_agg(to_jsonb(item) order by item.created_at desc, item.id desc)
        from paged item
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.search_audit_logs(
  text, text, text, uuid, uuid, timestamptz, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.search_audit_logs(
  text, text, text, uuid, uuid, timestamptz, timestamptz, integer, integer
) to authenticated;

create unique index audit_logs_admin_export_idempotency_unique
  on public.audit_logs ((metadata ->> 'idempotency_key'))
  where action = 'ADMIN_EXPORT_COMPLETED';

create function public.record_administrative_export(
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
    'PRODUCTS', 'INVENTORY', 'STOCK_MOVEMENTS', 'AUDIT_LOGS', 'IMPORT_REPORT'
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
  select audit.*
  into existing_log
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
    actor_id,
    'ADMIN_EXPORT_COMPLETED',
    'data_export',
    export_id::text,
    jsonb_build_object(
      'export_type', export_type_value,
      'format', format_value,
      'row_count', p_row_count
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

revoke all on function public.record_administrative_export(text, text, integer, text)
from public, anon, authenticated;
grant execute on function public.record_administrative_export(text, text, integer, text)
to authenticated;

comment on function private.audit_payload_is_safe(jsonb) is
  'Rejeita nomes de campos e padrões associados a senhas, tokens, segredos e conexões administrativas.';
comment on function public.search_audit_logs(
  text, text, text, uuid, uuid, timestamptz, timestamptz, integer, integer
) is 'Consulta administrativa paginada e filtrável de audit_logs; RLS permanece como autoridade.';
comment on function public.record_administrative_export(text, text, integer, text) is
  'Registra conclusão idempotente de exportação administrativa sem receber conteúdo exportado ou credenciais.';

commit;
