begin;

-- Staging is readable by ADMIN through RLS, but it must never be writable through
-- the generic Data API. SECURITY DEFINER import RPCs own validation and mutation.
revoke insert, update, delete on table public.import_batches from authenticated;
revoke update (
  status,
  total_rows,
  valid_rows,
  invalid_rows,
  confirmed_at,
  confirmed_by,
  metadata,
  detected_headers,
  column_mapping,
  mapping_version,
  parser_options,
  dry_run_summary,
  value_mapping,
  value_mapping_version,
  approved_category_creations
) on public.import_batches from authenticated;

revoke insert, update, delete on table public.import_rows from authenticated;
revoke update (
  normalized_data,
  validation_status,
  validation_errors,
  resolved_entity_id,
  dry_run_action,
  source_row_hash,
  validation_state,
  validation_suggestions,
  category_candidate
) on public.import_rows from authenticated;

revoke insert, update, delete on table public.external_entity_mappings from authenticated;
revoke update (internal_id, metadata) on public.external_entity_mappings from authenticated;

drop policy if exists import_batches_admin_insert on public.import_batches;
drop policy if exists import_batches_admin_update on public.import_batches;
drop policy if exists import_rows_admin_insert on public.import_rows;
drop policy if exists import_rows_admin_update on public.import_rows;
drop policy if exists external_entity_mappings_admin_insert on public.external_entity_mappings;
drop policy if exists external_entity_mappings_admin_update on public.external_entity_mappings;

comment on table public.import_batches is
  'Lotes de importação: leitura administrativa via RLS; mutações somente por RPCs de importação.';
comment on table public.import_rows is
  'Staging append-controlled: leitura administrativa via RLS; mutações somente por RPCs validadas.';
comment on table public.external_entity_mappings is
  'Mapeamentos externos mantidos somente pelos fluxos transacionais de confirmação.';

commit;
