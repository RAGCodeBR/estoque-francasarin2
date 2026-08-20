begin;

insert into public.roles (code, name, description)
values
  ('ADMIN', 'Administrador', 'Gerenciamento administrativo completo do sistema.'),
  ('STOCK_OPERATOR', 'Operador de estoque', 'Operações autorizadas de estoque e documentos.'),
  ('VIEWER', 'Visualizador', 'Consulta de estoque e relatórios.')
on conflict (lower(btrim(code))) do update
set
  name = excluded.name,
  description = excluded.description,
  is_active = true,
  updated_at = statement_timestamp();

insert into public.profiles (id, display_name)
select
  auth_user.id,
  coalesce(
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'Usuário'
  )
from auth.users auth_user
on conflict (id) do nothing;

create function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_active
  );
$$;

create function private.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.user_roles assignment
    join public.roles role on role.id = assignment.role_id
    join public.profiles profile on profile.id = assignment.profile_id
    where assignment.profile_id = (select auth.uid())
      and profile.is_active
      and role.is_active
      and upper(btrim(role.code)) = upper(btrim(required_role))
  );
$$;

create function private.has_any_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.user_roles assignment
    join public.roles role on role.id = assignment.role_id
    join public.profiles profile on profile.id = assignment.profile_id
    where assignment.profile_id = (select auth.uid())
      and profile.is_active
      and role.is_active
      and upper(btrim(role.code)) = any(required_roles)
  );
$$;

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  generated_display_name text;
begin
  generated_display_name := coalesce(
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuário'
  );

  insert into public.profiles (id, display_name)
  values (new.id, generated_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

create function private.protect_profile_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id then
    raise exception using errcode = '42501', message = 'profile id is immutable';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'profile creation timestamp is immutable';
  end if;

  if current_user not in ('postgres', 'supabase_admin')
    and not private.has_role('ADMIN')
    and new.is_active is distinct from old.is_active
  then
    raise exception using errcode = '42501', message = 'only ADMIN can change profile status';
  end if;

  if current_user not in ('postgres', 'supabase_admin')
    and old.is_active
    and not new.is_active
    and exists (
      select 1
      from public.user_roles assignment
      join public.roles role on role.id = assignment.role_id
      where assignment.profile_id = old.id
        and upper(btrim(role.code)) = 'ADMIN'
        and role.is_active
    )
    and not exists (
      select 1
      from public.user_roles other_assignment
      join public.roles other_role on other_role.id = other_assignment.role_id
      join public.profiles other_profile on other_profile.id = other_assignment.profile_id
      where upper(btrim(other_role.code)) = 'ADMIN'
        and other_role.is_active
        and other_profile.is_active
        and other_assignment.profile_id <> old.id
    )
  then
    raise exception using errcode = '55000', message = 'cannot deactivate the last active ADMIN';
  end if;

  return new;
end;
$$;

create function private.prevent_last_admin_removal()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  removed_role_code text;
begin
  select upper(btrim(role.code))
  into removed_role_code
  from public.roles role
  where role.id = old.role_id;

  if removed_role_code = 'ADMIN'
    and not exists (
      select 1
      from public.user_roles other_assignment
      join public.roles other_role on other_role.id = other_assignment.role_id
      join public.profiles other_profile on other_profile.id = other_assignment.profile_id
      where upper(btrim(other_role.code)) = 'ADMIN'
        and other_role.is_active
        and other_profile.is_active
        and other_assignment.profile_id <> old.profile_id
    )
  then
    raise exception using errcode = '55000', message = 'cannot remove the last active ADMIN';
  end if;

  return old;
end;
$$;

revoke all on function private.is_active_user() from public, anon, authenticated;
revoke all on function private.has_role(text) from public, anon, authenticated;
revoke all on function private.has_any_role(text[]) from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
revoke all on function private.protect_profile_fields() from public, anon, authenticated;
revoke all on function private.prevent_last_admin_removal() from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.has_role(text) to authenticated;
grant execute on function private.has_any_role(text[]) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create trigger profiles_protect_fields
before update on public.profiles
for each row execute function private.protect_profile_fields();

create trigger user_roles_prevent_last_admin_delete
before delete on public.user_roles
for each row execute function private.prevent_last_admin_removal();

grant select on public.profiles to authenticated;
grant update (display_name, is_active) on public.profiles to authenticated;
grant select on public.roles to authenticated;
grant select, delete on public.user_roles to authenticated;
grant insert (profile_id, role_id, granted_by) on public.user_roles to authenticated;

create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (
  (select private.is_active_user())
  and (id = (select auth.uid()) or (select private.has_role('ADMIN')))
);

create policy profiles_update_self_or_admin
on public.profiles for update to authenticated
using (
  (select private.is_active_user())
  and (id = (select auth.uid()) or (select private.has_role('ADMIN')))
)
with check (
  (select private.is_active_user())
  and (id = (select auth.uid()) or (select private.has_role('ADMIN')))
);

create policy roles_select_authorized
on public.roles for select to authenticated
using (
  (select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER']))
);

create policy user_roles_select_self_or_admin
on public.user_roles for select to authenticated
using (
  (select private.is_active_user())
  and (profile_id = (select auth.uid()) or (select private.has_role('ADMIN')))
);

create policy user_roles_admin_insert
on public.user_roles for insert to authenticated
with check (
  (select private.has_role('ADMIN'))
  and granted_by = (select auth.uid())
  and exists (select 1 from public.profiles profile where profile.id = profile_id and profile.is_active)
  and exists (select 1 from public.roles role where role.id = role_id and role.is_active)
);

create policy user_roles_admin_delete
on public.user_roles for delete to authenticated
using ((select private.has_role('ADMIN')));

grant select, insert on public.categories to authenticated;
grant update (name, description, is_active, updated_by) on public.categories to authenticated;
grant select, insert on public.locations to authenticated;
grant update (
  name, description, location_type, is_active, updated_by
) on public.locations to authenticated;
grant select, insert on public.suppliers to authenticated;
grant update (legal_name, trade_name, document, is_active) on public.suppliers to authenticated;
grant select, insert on public.products to authenticated;
grant update (
  name, sku, ean, product_type, unit, category_id, minimum_quantity, is_active, updated_by
) on public.products to authenticated;
grant select, insert on public.supplier_product_mappings to authenticated;
grant update (product_id) on public.supplier_product_mappings to authenticated;

create policy categories_read_authorized
on public.categories for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy categories_admin_insert
on public.categories for insert to authenticated
with check ((select private.has_role('ADMIN')) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy categories_admin_update
on public.categories for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')) and updated_by = (select auth.uid()));

create policy locations_read_authorized
on public.locations for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy locations_admin_insert
on public.locations for insert to authenticated
with check ((select private.has_role('ADMIN')) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy locations_admin_update
on public.locations for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')) and updated_by = (select auth.uid()));

create policy suppliers_read_authorized
on public.suppliers for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy suppliers_admin_insert
on public.suppliers for insert to authenticated
with check ((select private.has_role('ADMIN')));
create policy suppliers_admin_update
on public.suppliers for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')));

create policy products_read_authorized
on public.products for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy products_admin_insert
on public.products for insert to authenticated
with check ((select private.has_role('ADMIN')) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy products_admin_update
on public.products for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')) and updated_by = (select auth.uid()));

create policy supplier_product_mappings_read_authorized
on public.supplier_product_mappings for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy supplier_product_mappings_admin_insert
on public.supplier_product_mappings for insert to authenticated
with check ((select private.has_role('ADMIN')));
create policy supplier_product_mappings_admin_update
on public.supplier_product_mappings for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')));

grant select, insert, delete on public.invoices, public.invoice_items to authenticated;
grant update (
  supplier_id,
  access_key,
  invoice_number,
  series,
  issued_at,
  imported_at,
  status,
  original_file_path
) on public.invoices to authenticated;
grant update (
  line_number,
  product_id,
  supplier_product_code,
  description,
  quantity,
  unit,
  unit_price,
  total_amount
) on public.invoice_items to authenticated;

create policy invoices_read_authorized
on public.invoices for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy invoices_admin_insert
on public.invoices for insert to authenticated
with check ((select private.has_role('ADMIN')) and created_by = (select auth.uid()));
create policy invoices_operator_insert
on public.invoices for insert to authenticated
with check (
  (select private.has_role('STOCK_OPERATOR'))
  and created_by = (select auth.uid())
  and status = 'DRAFT'
);
create policy invoices_admin_update
on public.invoices for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')));
create policy invoices_operator_update
on public.invoices for update to authenticated
using (
  (select private.has_role('STOCK_OPERATOR'))
  and created_by = (select auth.uid())
  and status = 'DRAFT'
)
with check (
  (select private.has_role('STOCK_OPERATOR'))
  and created_by = (select auth.uid())
  and status in ('DRAFT', 'PENDING_REVIEW', 'CANCELLED')
);
create policy invoices_draft_delete
on public.invoices for delete to authenticated
using (
  status = 'DRAFT'
  and (
    (select private.has_role('ADMIN'))
    or ((select private.has_role('STOCK_OPERATOR')) and created_by = (select auth.uid()))
  )
);

create policy invoice_items_read_authorized
on public.invoice_items for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));
create policy invoice_items_draft_insert
on public.invoice_items for insert to authenticated
with check (
  exists (
    select 1
    from public.invoices invoice
    where invoice.id = invoice_id
      and invoice.status = 'DRAFT'
      and (
        (select private.has_role('ADMIN'))
        or ((select private.has_role('STOCK_OPERATOR')) and invoice.created_by = (select auth.uid()))
      )
  )
);
create policy invoice_items_draft_update
on public.invoice_items for update to authenticated
using (
  exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and invoice.status = 'DRAFT'
      and (
        (select private.has_role('ADMIN'))
        or ((select private.has_role('STOCK_OPERATOR')) and invoice.created_by = (select auth.uid()))
      )
  )
)
with check (
  exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and invoice.status = 'DRAFT'
      and (
        (select private.has_role('ADMIN'))
        or ((select private.has_role('STOCK_OPERATOR')) and invoice.created_by = (select auth.uid()))
      )
  )
);
create policy invoice_items_draft_delete
on public.invoice_items for delete to authenticated
using (
  exists (
    select 1 from public.invoices invoice
    where invoice.id = invoice_id and invoice.status = 'DRAFT'
      and (
        (select private.has_role('ADMIN'))
        or ((select private.has_role('STOCK_OPERATOR')) and invoice.created_by = (select auth.uid()))
      )
  )
);

grant select on public.stock_balances, public.stock_movements to authenticated;

create policy stock_balances_read_authorized
on public.stock_balances for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));

create policy stock_movements_read_authorized
on public.stock_movements for select to authenticated
using ((select private.has_any_role(array['ADMIN', 'STOCK_OPERATOR', 'VIEWER'])));

grant select on public.audit_logs to authenticated;

create policy audit_logs_admin_read
on public.audit_logs for select to authenticated
using ((select private.has_role('ADMIN')));

grant select, insert on public.import_batches to authenticated;
grant update (
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
) on public.import_batches to authenticated;

grant select, insert on public.import_rows to authenticated;
grant update (
  normalized_data,
  validation_status,
  validation_errors,
  resolved_entity_id,
  dry_run_action,
  source_row_hash,
  validation_state,
  validation_suggestions,
  category_candidate
) on public.import_rows to authenticated;

create policy import_batches_admin_read
on public.import_batches for select to authenticated
using ((select private.has_role('ADMIN')));
create policy import_batches_admin_insert
on public.import_batches for insert to authenticated
with check ((select private.has_role('ADMIN')) and created_by = (select auth.uid()));
create policy import_batches_admin_update
on public.import_batches for update to authenticated
using ((select private.has_role('ADMIN')))
with check (
  (select private.has_role('ADMIN'))
  and (confirmed_by is null or confirmed_by = (select auth.uid()))
);

create policy import_rows_admin_read
on public.import_rows for select to authenticated
using (
  (select private.has_role('ADMIN'))
  and exists (
    select 1 from public.import_batches batch where batch.id = import_batch_id
  )
);
create policy import_rows_admin_insert
on public.import_rows for insert to authenticated
with check (
  (select private.has_role('ADMIN'))
  and exists (
    select 1 from public.import_batches batch where batch.id = import_batch_id
  )
);
create policy import_rows_admin_update
on public.import_rows for update to authenticated
using (
  (select private.has_role('ADMIN'))
  and exists (
    select 1 from public.import_batches batch where batch.id = import_batch_id
  )
)
with check (
  (select private.has_role('ADMIN'))
  and exists (
    select 1 from public.import_batches batch where batch.id = import_batch_id
  )
);

grant select, insert on public.external_entity_mappings to authenticated;
grant update (internal_id, metadata) on public.external_entity_mappings to authenticated;

create policy external_entity_mappings_admin_read
on public.external_entity_mappings for select to authenticated
using ((select private.has_role('ADMIN')));
create policy external_entity_mappings_admin_insert
on public.external_entity_mappings for insert to authenticated
with check ((select private.has_role('ADMIN')));
create policy external_entity_mappings_admin_update
on public.external_entity_mappings for update to authenticated
using ((select private.has_role('ADMIN')))
with check ((select private.has_role('ADMIN')));

do $storage$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    execute $sql$
      insert into storage.buckets (
        id, name, public, file_size_limit, allowed_mime_types
      ) values (
        'import-files',
        'import-files',
        false,
        10485760,
        array[
          'text/csv',
          'application/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
      )
      on conflict (id) do update
      set
        public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $sql$;

    execute 'drop policy if exists import_files_admin_select on storage.objects';
    execute 'drop policy if exists import_files_admin_insert on storage.objects';
    execute 'drop policy if exists import_files_admin_update on storage.objects';
    execute 'drop policy if exists import_files_admin_delete on storage.objects';

    execute $policy$
      create policy import_files_admin_select
      on storage.objects for select to authenticated
      using (bucket_id = 'import-files' and (select private.has_role('ADMIN')))
    $policy$;
    execute $policy$
      create policy import_files_admin_insert
      on storage.objects for insert to authenticated
      with check (bucket_id = 'import-files' and (select private.has_role('ADMIN')))
    $policy$;
    execute $policy$
      create policy import_files_admin_update
      on storage.objects for update to authenticated
      using (bucket_id = 'import-files' and (select private.has_role('ADMIN')))
      with check (bucket_id = 'import-files' and (select private.has_role('ADMIN')))
    $policy$;
    execute $policy$
      create policy import_files_admin_delete
      on storage.objects for delete to authenticated
      using (bucket_id = 'import-files' and (select private.has_role('ADMIN')))
    $policy$;
  end if;
end;
$storage$;

comment on function private.has_role(text) is
  'Autorização baseada somente em profiles, roles e user_roles; nunca em JWT user_metadata.';
comment on table public.stock_balances is
  'Leitura via RLS; nenhuma mutação direta é concedida a usuários da aplicação.';
comment on table public.stock_movements is
  'Leitura via RLS; inserções futuras exigirão o motor transacional e histórico permanece append-only.';

commit;
