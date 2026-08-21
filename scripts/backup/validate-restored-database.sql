\set ON_ERROR_STOP on

do $$
declare
  missing_tables text[];
begin
  select array_agg(required.name order by required.name)
  into missing_tables
  from unnest(array[
    'audit_logs', 'categories', 'import_batches', 'import_rows', 'products',
    'stock_balances', 'stock_movements', 'user_roles'
  ]) required(name)
  where to_regclass('public.' || required.name) is null;

  if missing_tables is not null then
    raise exception 'required tables are missing: %', missing_tables;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from public.stock_balances where quantity < 0) then
    raise exception 'negative stock balance found after restore';
  end if;

  if exists (
    select 1
    from public.stock_balances balance
    join public.stock_movements movement on movement.id = balance.last_movement_id
    where movement.balance_after is distinct from balance.quantity
  ) then
    raise exception 'stock balance does not match its last movement';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname <> 'spatial_ref_sys'
      and not relation.relrowsecurity
  ) then
    raise exception 'public table without RLS found after restore';
  end if;

  if not exists (select 1 from public.roles where code = 'ADMIN') then
    raise exception 'ADMIN application role was not restored';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger where tgname = 'stock_movements_prevent_update'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger where tgname = 'stock_movements_prevent_delete'
  ) then
    raise exception 'stock_movements append-only triggers were not restored';
  end if;
end;
$$;

select
  (select count(*) from public.products) as products,
  (select count(*) from public.stock_movements) as stock_movements,
  (select count(*) from public.audit_logs) as audit_logs,
  (select count(*) from supabase_migrations.schema_migrations) as migrations;
