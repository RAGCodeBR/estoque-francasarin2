begin;

create type public.import_row_dry_run_action as enum (
  'NEW',
  'UPDATE_CANDIDATE',
  'CONFLICT',
  'IGNORED'
);

alter table public.import_batches
  add column file_size_bytes bigint,
  add column detected_headers jsonb not null default '[]'::jsonb,
  add column column_mapping jsonb,
  add column mapping_version integer not null default 1,
  add column parser_options jsonb not null default '{}'::jsonb,
  add column dry_run_summary jsonb,
  add column duplicate_of_batch_id uuid references public.import_batches (id) on delete restrict,
  add constraint import_batches_file_size_positive check (
    file_size_bytes is null or file_size_bytes > 0
  ),
  add constraint import_batches_detected_headers_array check (
    jsonb_typeof(detected_headers) = 'array'
  ),
  add constraint import_batches_column_mapping_array check (
    column_mapping is null or jsonb_typeof(column_mapping) = 'array'
  ),
  add constraint import_batches_mapping_version_positive check (mapping_version > 0),
  add constraint import_batches_parser_options_object check (
    jsonb_typeof(parser_options) = 'object'
  ),
  add constraint import_batches_dry_run_summary_object check (
    dry_run_summary is null or jsonb_typeof(dry_run_summary) = 'object'
  ),
  add constraint import_batches_duplicate_not_self check (
    duplicate_of_batch_id is null or duplicate_of_batch_id <> id
  );

alter table public.import_rows
  add column dry_run_action public.import_row_dry_run_action,
  add column source_row_hash text,
  add constraint import_rows_source_row_hash_not_blank check (
    source_row_hash is null or btrim(source_row_hash) <> ''
  );

create unique index import_batches_original_file_hash_unique
  on public.import_batches (file_hash)
  where duplicate_of_batch_id is null
    and status not in ('FAILED', 'CANCELLED');

create index import_batches_duplicate_of_batch_id_idx
  on public.import_batches (duplicate_of_batch_id)
  where duplicate_of_batch_id is not null;

create index import_rows_dry_run_action_idx
  on public.import_rows (dry_run_action)
  where dry_run_action is not null;

comment on column public.import_batches.detected_headers is
  'Cabeçalhos descobertos no arquivo, preservados antes de qualquer mapeamento.';
comment on column public.import_batches.column_mapping is
  'Mapeamento versionado de coluna externa para campo canônico ou IGNORE.';
comment on column public.import_batches.dry_run_summary is
  'Resumo reproduzível do último dry-run; não representa promoção para tabelas oficiais.';
comment on column public.import_batches.duplicate_of_batch_id is
  'Referência explícita ao lote original quando um reprocessamento idêntico foi autorizado.';

commit;
