begin;

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
  if format_value is null or format_value not in ('CSV', 'XLSX', 'JSON', 'PDF') then
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

revoke all on function public.record_administrative_export(text, text, integer, text)
from public, anon, authenticated;
grant execute on function public.record_administrative_export(text, text, integer, text)
to authenticated;

comment on function public.record_administrative_export(text, text, integer, text) is
  'Registra conclusão idempotente de exportações administrativas CSV, XLSX, JSON ou PDF sem receber o conteúdo exportado.';

commit;
