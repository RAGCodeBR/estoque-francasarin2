begin;

create schema if not exists private;

revoke all on schema private from public;

create type public.product_type as enum (
  'RAW',
  'FRACTIONATED'
);

create type public.unit_type as enum (
  'UN',
  'KG'
);

create type public.location_type as enum (
  'STOCK',
  'CONSUMPTION'
);

create type public.movement_type as enum (
  'PURCHASE_ENTRY',
  'CONSUMPTION_EXIT',
  'LOSS',
  'ADJUSTMENT_POSITIVE',
  'ADJUSTMENT_NEGATIVE',
  'TRANSFER',
  'FRACTIONATION',
  'MIGRATION_OPENING_BALANCE'
);

create type public.invoice_status as enum (
  'DRAFT',
  'PENDING_REVIEW',
  'CONFIRMED',
  'CANCELLED'
);

create type public.import_status as enum (
  'UPLOADED',
  'ANALYZING',
  'PENDING_MAPPING',
  'VALIDATING',
  'READY',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

create type public.import_row_validation_status as enum (
  'PENDING',
  'VALID',
  'INVALID',
  'RESOLVED'
);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create function private.prevent_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only; create a compensating record instead', tg_table_name);
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.prevent_history_mutation() from public;

commit;
