import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const fileName of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, fileName), 'utf8'));
  }
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = pg_catalog
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id text primary key default ('object-' || random()::text),
      bucket_id text not null references storage.buckets (id),
      name text not null
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  await runMigrations(database);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('catálogo de segurança PostgreSQL/Supabase', () => {
  it('mantém RLS e policies em todas as tabelas públicas', async () => {
    const result = await database.query<{
      table_name: string;
      rls_enabled: boolean;
      policy_count: number;
    }>(`
      select
        class.relname as table_name,
        class.relrowsecurity as rls_enabled,
        count(policy.polname)::integer as policy_count
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_policy policy on policy.polrelid = class.oid
      where namespace.nspname = 'public' and class.relkind in ('r', 'p')
      group by class.relname, class.relrowsecurity
      order by class.relname;
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.filter((row) => !row.rls_enabled || row.policy_count === 0)).toEqual([]);
  });

  it('não expõe views públicas que contornem RLS', async () => {
    const result = await database.query<{ view_name: string }>(`
      select class.relname as view_name
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and class.relkind in ('v', 'm');
    `);

    expect(result.rows).toEqual([]);
  });

  it('fixa o search_path de todas as funções SECURITY DEFINER', async () => {
    const result = await database.query<{ signature: string; settings: string[] | null }>(`
      select procedure.oid::regprocedure::text as signature, procedure.proconfig as settings
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'private')
        and procedure.prosecdef
        and not ('search_path=pg_catalog' = any(coalesce(procedure.proconfig, array[]::text[])))
      order by 1;
    `);

    expect(result.rows).toEqual([]);
  });

  it('nega EXECUTE anônimo em todas as funções da aplicação', async () => {
    const result = await database.query<{ signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('public', 'private')
        and has_function_privilege('anon', procedure.oid, 'EXECUTE')
      order by 1;
    `);

    expect(result.rows).toEqual([]);
  });

  it('expõe ao authenticated somente os helpers privados necessários ao RLS', async () => {
    const result = await database.query<{ signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'private'
        and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      order by 1;
    `);

    expect(result.rows.map(({ signature }) => signature)).toEqual([
      'private.has_any_role(text[])',
      'private.has_role(text)',
      'private.is_active_user()',
    ]);
  });

  it('não concede BYPASSRLS às roles da Data API', async () => {
    const result = await database.query<{ rolname: string; rolbypassrls: boolean }>(`
      select rolname, rolbypassrls
      from pg_roles
      where rolname in ('anon', 'authenticated')
      order by rolname;
    `);

    expect(result.rows).toEqual([
      { rolname: 'anon', rolbypassrls: false },
      { rolname: 'authenticated', rolbypassrls: false },
    ]);
  });

  it('não concede escrita direta nas tabelas críticas de staging', async () => {
    const result = await database.query<{
      table_name: string;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(`
      select
        table_name,
        has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') as can_insert,
        has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE') as can_update,
        has_table_privilege('authenticated', 'public.' || table_name, 'DELETE') as can_delete
      from unnest(array[
        'import_batches',
        'import_rows',
        'external_entity_mappings'
      ]) as tables(table_name)
      order by table_name;
    `);

    expect(result.rows).toEqual([
      {
        table_name: 'external_entity_mappings',
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
      { table_name: 'import_batches', can_insert: false, can_update: false, can_delete: false },
      { table_name: 'import_rows', can_insert: false, can_update: false, can_delete: false },
    ]);
  });
});
