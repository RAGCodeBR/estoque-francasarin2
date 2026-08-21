begin;

-- Uma única policy por operação evita avaliar duas árvores permissivas por linha e mantém
-- exatamente a matriz ADMIN/operador existente.
drop policy invoices_admin_insert on public.invoices;
drop policy invoices_operator_insert on public.invoices;
drop policy invoices_admin_update on public.invoices;
drop policy invoices_operator_update on public.invoices;

create policy invoices_authorized_insert
on public.invoices for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (select private.has_role('ADMIN'))
    or (
      (select private.has_role('STOCK_OPERATOR'))
      and status = 'DRAFT'
    )
  )
);

create policy invoices_authorized_update
on public.invoices for update to authenticated
using (
  (select private.has_role('ADMIN'))
  or (
    (select private.has_role('STOCK_OPERATOR'))
    and created_by = (select auth.uid())
    and status = 'DRAFT'
  )
)
with check (
  (select private.has_role('ADMIN'))
  or (
    (select private.has_role('STOCK_OPERATOR'))
    and created_by = (select auth.uid())
    and status in ('DRAFT', 'PENDING_REVIEW', 'CANCELLED')
  )
);

-- Navegação temporal sem filtro de produto/tipo. Atende dashboard, relatórios e exportações.
create index stock_movements_created_at_browse_idx
  on public.stock_movements (created_at desc, id desc);

-- Filtro de status e período é o caminho principal das listagens de notas.
create index invoices_status_issued_at_idx
  on public.invoices (status, issued_at desc, id desc);

-- Foreign keys opcionais não recebem índice automaticamente no PostgreSQL. Estes caminhos
-- evitam varreduras integrais em joins e ao validar inativação/exclusão referencial.
create index import_batches_stock_location_id_idx
  on public.import_batches (stock_location_id)
  where stock_location_id is not null;
create index inventory_counts_started_by_idx
  on public.inventory_counts (started_by)
  where started_by is not null;
create index inventory_counts_reviewed_by_idx
  on public.inventory_counts (reviewed_by)
  where reviewed_by is not null;
create index invoice_imports_resolved_supplier_id_idx
  on public.invoice_imports (resolved_supplier_id)
  where resolved_supplier_id is not null;
create index invoice_imports_confirmed_invoice_id_idx
  on public.invoice_imports (confirmed_invoice_id)
  where confirmed_invoice_id is not null;
create index invoice_imports_confirmed_by_idx
  on public.invoice_imports (confirmed_by)
  where confirmed_by is not null;
create index invoice_imports_reviewed_by_idx
  on public.invoice_imports (reviewed_by)
  where reviewed_by is not null;

-- A detecção de identificadores repetidos acontece sempre dentro de um lote. Os índices
-- parciais mantêm fora deles linhas ignoradas e tipos de importação que não usam a chave.
create index import_rows_batch_normalized_sku_idx
  on public.import_rows (
    import_batch_id,
    lower(normalized_data ->> 'sku')
  )
  where validation_state <> 'IGNORED'
    and nullif(normalized_data ->> 'sku', '') is not null;

create index import_rows_batch_normalized_ean_idx
  on public.import_rows (
    import_batch_id,
    (normalized_data ->> 'ean')
  )
  where validation_state <> 'IGNORED'
    and nullif(normalized_data ->> 'ean', '') is not null;

create index import_rows_batch_normalized_external_id_idx
  on public.import_rows (
    import_batch_id,
    (normalized_data ->> 'external_id')
  )
  where validation_state <> 'IGNORED'
    and nullif(normalized_data ->> 'external_id', '') is not null;

create index import_rows_batch_normalized_name_idx
  on public.import_rows (
    import_batch_id,
    lower(btrim(normalized_data ->> 'name'))
  )
  where validation_state <> 'IGNORED'
    and nullif(btrim(normalized_data ->> 'name'), '') is not null;

create index import_rows_batch_normalized_document_idx
  on public.import_rows (
    import_batch_id,
    (normalized_data ->> 'document')
  )
  where validation_state <> 'IGNORED'
    and nullif(normalized_data ->> 'document', '') is not null;

create index import_rows_batch_normalized_legal_name_idx
  on public.import_rows (
    import_batch_id,
    lower(btrim(normalized_data ->> 'legal_name'))
  )
  where validation_state <> 'IGNORED'
    and nullif(btrim(normalized_data ->> 'legal_name'), '') is not null;

-- Índices compostos posteriores cobrem os mesmos prefixos e também ordenação temporal.
-- Removê-los reduz amplificação de escrita nos históricos mais volumosos.
drop index public.invoices_supplier_id_idx;
drop index public.invoice_items_product_id_idx;
drop index public.stock_movements_source_location_id_idx;
drop index public.stock_movements_destination_location_id_idx;
drop index public.stock_movements_import_batch_id_idx;
drop index public.stock_movements_created_by_idx;
drop index public.stock_losses_created_by_idx;
drop index public.audit_logs_actor_id_idx;
drop index public.audit_logs_entity_idx;
drop index public.audit_logs_created_at_idx;

create index audit_logs_created_at_idx
  on public.audit_logs (created_at desc, id desc);

-- Históricos append-only precisam de estatísticas novas antes do limiar padrão de 10%.
-- import_rows e stock_balances também acumulam updates e recebem vacuum mais cedo.
alter table public.stock_movements set (
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.invoice_items set (
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.audit_logs set (
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.import_rows set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.stock_balances set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

comment on index public.stock_movements_created_at_browse_idx is
  'Paginação temporal, dashboard e recortes por período sem filtro adicional.';
comment on index public.import_rows_batch_normalized_sku_idx is
  'Detecção de SKU duplicado dentro do staging sem varredura quadrática.';

commit;
