begin;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.supplier_product_mappings enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.external_entity_mappings enable row level security;

revoke all privileges on table
  public.profiles,
  public.roles,
  public.user_roles,
  public.categories,
  public.locations,
  public.suppliers,
  public.products,
  public.supplier_product_mappings,
  public.invoices,
  public.invoice_items,
  public.stock_balances,
  public.stock_movements,
  public.audit_logs,
  public.import_batches,
  public.import_rows,
  public.external_entity_mappings
from anon, authenticated;

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

alter default privileges in schema public
revoke all on tables from anon, authenticated;

alter default privileges in schema private
revoke all on functions from public, anon, authenticated;

commit;
