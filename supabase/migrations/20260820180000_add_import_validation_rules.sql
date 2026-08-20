begin;

create type public.import_row_validation_state as enum (
  'VALID',
  'WARNING',
  'ERROR',
  'CONFLICT',
  'IGNORED'
);

alter table public.import_batches
  add column value_mapping jsonb not null default '{}'::jsonb,
  add column value_mapping_version integer not null default 1,
  add column approved_category_creations jsonb not null default '[]'::jsonb,
  add constraint import_batches_value_mapping_object check (
    jsonb_typeof(value_mapping) = 'object'
  ),
  add constraint import_batches_value_mapping_version_positive check (
    value_mapping_version > 0
  ),
  add constraint import_batches_approved_categories_array check (
    jsonb_typeof(approved_category_creations) = 'array'
  );

alter table public.import_rows
  add column validation_state public.import_row_validation_state,
  add column validation_suggestions jsonb not null default '[]'::jsonb,
  add column category_candidate jsonb,
  add constraint import_rows_validation_suggestions_array check (
    jsonb_typeof(validation_suggestions) = 'array'
  ),
  add constraint import_rows_category_candidate_object check (
    category_candidate is null or jsonb_typeof(category_candidate) = 'object'
  );

create index import_rows_validation_state_idx
  on public.import_rows (validation_state)
  where validation_state is not null;

comment on column public.import_batches.value_mapping is
  'ValueMapping configurável e versionado para unidades, tipos e futuros domínios enumerados.';
comment on column public.import_batches.approved_category_creations is
  'Categorias inexistentes cuja criação foi aprovada explicitamente no preview.';
comment on column public.import_rows.validation_state is
  'Estado final do último dry-run: VALID, WARNING, ERROR, CONFLICT ou IGNORED.';
comment on column public.import_rows.validation_suggestions is
  'Sugestões informativas, inclusive nome semelhante; nunca autorizam merge automático.';
comment on column public.import_rows.category_candidate is
  'Categoria inexistente candidata à criação e sua decisão explícita de aprovação.';

commit;
