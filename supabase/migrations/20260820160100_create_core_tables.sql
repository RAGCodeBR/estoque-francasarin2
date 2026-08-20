begin;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_display_name_not_blank check (btrim(display_name) <> '')
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint roles_code_not_blank check (btrim(code) <> ''),
  constraint roles_name_not_blank check (btrim(name) <> ''),
  constraint roles_description_not_blank check (description is null or btrim(description) <> '')
);

create table public.user_roles (
  profile_id uuid not null references public.profiles (id) on delete restrict,
  role_id uuid not null references public.roles (id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  granted_by uuid not null references public.profiles (id) on delete restrict,
  primary key (profile_id, role_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  constraint categories_name_not_blank check (btrim(name) <> ''),
  constraint categories_description_not_blank check (
    description is null or btrim(description) <> ''
  )
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  location_type public.location_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  constraint locations_name_not_blank check (btrim(name) <> ''),
  constraint locations_description_not_blank check (
    description is null or btrim(description) <> ''
  )
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  document text,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint suppliers_legal_name_not_blank check (btrim(legal_name) <> ''),
  constraint suppliers_trade_name_not_blank check (trade_name is null or btrim(trade_name) <> ''),
  constraint suppliers_document_not_blank check (document is null or btrim(document) <> '')
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null,
  ean text,
  product_type public.product_type not null,
  unit public.unit_type not null,
  category_id uuid not null references public.categories (id) on delete restrict,
  minimum_quantity numeric(18, 3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_sku_not_blank check (btrim(sku) <> ''),
  constraint products_ean_not_blank check (ean is null or btrim(ean) <> ''),
  constraint products_minimum_quantity_nonnegative check (minimum_quantity >= 0)
);

create table public.supplier_product_mappings (
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  supplier_product_code text not null,
  product_id uuid not null references public.products (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (supplier_id, supplier_product_code),
  constraint supplier_product_mappings_code_not_blank check (btrim(supplier_product_code) <> '')
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_name text not null,
  original_filename text,
  file_hash text not null,
  status public.import_status not null default 'UPLOADED',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  constraint import_batches_source_type_not_blank check (btrim(source_type) <> ''),
  constraint import_batches_source_name_not_blank check (btrim(source_name) <> ''),
  constraint import_batches_original_filename_not_blank check (
    original_filename is null or btrim(original_filename) <> ''
  ),
  constraint import_batches_file_hash_not_blank check (btrim(file_hash) <> ''),
  constraint import_batches_row_counts_nonnegative check (
    total_rows >= 0 and valid_rows >= 0 and invalid_rows >= 0
  ),
  constraint import_batches_row_counts_consistent check (valid_rows + invalid_rows <= total_rows),
  constraint import_batches_confirmation_consistent check (
    (confirmed_at is null and confirmed_by is null)
    or (confirmed_at is not null and confirmed_by is not null)
  ),
  constraint import_batches_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches (id) on delete restrict,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb,
  validation_status public.import_row_validation_status not null default 'PENDING',
  validation_errors jsonb not null default '[]'::jsonb,
  resolved_entity_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint import_rows_batch_row_unique unique (import_batch_id, row_number),
  constraint import_rows_row_number_positive check (row_number > 0),
  constraint import_rows_raw_data_object check (jsonb_typeof(raw_data) = 'object'),
  constraint import_rows_normalized_data_object check (
    normalized_data is null or jsonb_typeof(normalized_data) = 'object'
  ),
  constraint import_rows_validation_errors_array check (jsonb_typeof(validation_errors) = 'array')
);

create table public.external_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  entity_type text not null,
  external_id text not null,
  internal_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint external_entity_mappings_natural_key unique (
    source_system,
    entity_type,
    external_id
  ),
  constraint external_entity_mappings_source_system_not_blank check (btrim(source_system) <> ''),
  constraint external_entity_mappings_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint external_entity_mappings_external_id_not_blank check (btrim(external_id) <> ''),
  constraint external_entity_mappings_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  access_key text,
  invoice_number text not null,
  series text,
  issued_at timestamptz not null,
  imported_at timestamptz,
  status public.invoice_status not null default 'DRAFT',
  original_file_path text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint invoices_access_key_not_blank check (access_key is null or btrim(access_key) <> ''),
  constraint invoices_number_not_blank check (btrim(invoice_number) <> ''),
  constraint invoices_series_not_blank check (series is null or btrim(series) <> ''),
  constraint invoices_original_file_path_not_blank check (
    original_file_path is null or btrim(original_file_path) <> ''
  )
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  line_number integer not null,
  product_id uuid not null references public.products (id) on delete restrict,
  supplier_product_code text,
  description text not null,
  quantity numeric(18, 3) not null,
  unit public.unit_type not null,
  unit_price numeric(18, 4) not null,
  total_amount numeric(18, 2) not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint invoice_items_invoice_line_unique unique (invoice_id, line_number),
  constraint invoice_items_line_number_positive check (line_number > 0),
  constraint invoice_items_supplier_product_code_not_blank check (
    supplier_product_code is null or btrim(supplier_product_code) <> ''
  ),
  constraint invoice_items_description_not_blank check (btrim(description) <> ''),
  constraint invoice_items_quantity_positive check (quantity > 0),
  constraint invoice_items_unit_price_nonnegative check (unit_price >= 0),
  constraint invoice_items_total_amount_nonnegative check (total_amount >= 0)
);

create table public.stock_balances (
  product_id uuid primary key references public.products (id) on delete restrict,
  quantity numeric(18, 3) not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint stock_balances_quantity_nonnegative check (quantity >= 0)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  movement_type public.movement_type not null,
  quantity numeric(18, 3) not null,
  source_location_id uuid references public.locations (id) on delete restrict,
  destination_location_id uuid references public.locations (id) on delete restrict,
  invoice_id uuid references public.invoices (id) on delete restrict,
  import_batch_id uuid references public.import_batches (id) on delete restrict,
  reason text,
  reference_id uuid references public.stock_movements (id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  constraint stock_movements_quantity_positive check (quantity > 0),
  constraint stock_movements_locations_distinct check (
    source_location_id is null
    or destination_location_id is null
    or source_location_id <> destination_location_id
  ),
  constraint stock_movements_reason_not_blank check (reason is null or btrim(reason) <> ''),
  constraint stock_movements_reference_not_self check (reference_id is null or reference_id <> id),
  constraint stock_movements_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint stock_movements_idempotency_key_unique unique (idempotency_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id uuid,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint audit_logs_action_not_blank check (btrim(action) <> ''),
  constraint audit_logs_entity_type_not_blank check (btrim(entity_type) <> ''),
  constraint audit_logs_entity_id_not_blank check (entity_id is null or btrim(entity_id) <> ''),
  constraint audit_logs_old_data_object check (old_data is null or jsonb_typeof(old_data) = 'object'),
  constraint audit_logs_new_data_object check (new_data is null or jsonb_typeof(new_data) = 'object'),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create unique index roles_code_unique on public.roles (lower(btrim(code)));
create unique index categories_name_unique on public.categories (lower(btrim(name)));
create unique index locations_name_unique on public.locations (lower(btrim(name)));
create unique index suppliers_document_unique on public.suppliers (lower(btrim(document)))
where document is not null;
create unique index products_sku_unique on public.products (lower(btrim(sku)));
create index products_ean_idx on public.products (ean) where ean is not null;

create index user_roles_role_id_idx on public.user_roles (role_id);
create index user_roles_granted_by_idx on public.user_roles (granted_by);
create index categories_created_by_idx on public.categories (created_by);
create index categories_updated_by_idx on public.categories (updated_by);
create index locations_created_by_idx on public.locations (created_by);
create index locations_updated_by_idx on public.locations (updated_by);
create index products_category_id_idx on public.products (category_id);
create index products_created_by_idx on public.products (created_by);
create index products_updated_by_idx on public.products (updated_by);
create index supplier_product_mappings_product_id_idx
  on public.supplier_product_mappings (product_id);
create index import_batches_status_idx on public.import_batches (status);
create index import_batches_file_hash_idx on public.import_batches (file_hash);
create index import_batches_created_by_idx on public.import_batches (created_by);
create index import_batches_confirmed_by_idx on public.import_batches (confirmed_by)
where confirmed_by is not null;
create index import_rows_validation_status_idx on public.import_rows (validation_status);
create index import_rows_resolved_entity_id_idx on public.import_rows (resolved_entity_id)
where resolved_entity_id is not null;
create index external_entity_mappings_internal_lookup_idx
  on public.external_entity_mappings (entity_type, internal_id);
create unique index invoices_access_key_unique on public.invoices (btrim(access_key))
where access_key is not null;
create index invoices_supplier_id_idx on public.invoices (supplier_id);
create index invoices_status_idx on public.invoices (status);
create index invoices_created_by_idx on public.invoices (created_by);
create index invoice_items_product_id_idx on public.invoice_items (product_id);
create index stock_movements_product_created_at_idx
  on public.stock_movements (product_id, created_at desc);
create index stock_movements_source_location_id_idx
  on public.stock_movements (source_location_id)
where source_location_id is not null;
create index stock_movements_destination_location_id_idx
  on public.stock_movements (destination_location_id)
where destination_location_id is not null;
create index stock_movements_invoice_id_idx on public.stock_movements (invoice_id)
where invoice_id is not null;
create index stock_movements_import_batch_id_idx on public.stock_movements (import_batch_id)
where import_batch_id is not null;
create index stock_movements_reference_id_idx on public.stock_movements (reference_id)
where reference_id is not null;
create index stock_movements_created_by_idx on public.stock_movements (created_by);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id)
where actor_id is not null;
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger roles_set_updated_at
before update on public.roles
for each row execute function private.set_updated_at();

create trigger categories_set_updated_at
before update on public.categories
for each row execute function private.set_updated_at();

create trigger locations_set_updated_at
before update on public.locations
for each row execute function private.set_updated_at();

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create trigger stock_balances_set_updated_at
before update on public.stock_balances
for each row execute function private.set_updated_at();

create trigger stock_movements_prevent_update
before update on public.stock_movements
for each statement execute function private.prevent_history_mutation();

create trigger stock_movements_prevent_delete
before delete on public.stock_movements
for each statement execute function private.prevent_history_mutation();

create trigger audit_logs_prevent_update
before update on public.audit_logs
for each statement execute function private.prevent_history_mutation();

create trigger audit_logs_prevent_delete
before delete on public.audit_logs
for each statement execute function private.prevent_history_mutation();

comment on table public.import_rows is
  'Staging isolado para dados importados; nunca representa dados oficiais antes da confirmação.';
comment on table public.stock_balances is
  'Saldo consolidado do estoque central; somente o futuro motor transacional poderá alterá-lo.';
comment on table public.stock_movements is
  'Histórico append-only; correções devem criar movimentos compensatórios via reference_id.';
comment on column public.external_entity_mappings.internal_id is
  'UUID genérico da entidade interna; integridade específica é validada pelo fluxo de mapeamento.';

commit;
