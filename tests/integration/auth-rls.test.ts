import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  operator: '10000000-0000-4000-8000-000000000002',
  viewer: '10000000-0000-4000-8000-000000000003',
  noRole: '10000000-0000-4000-8000-000000000004',
  inactiveViewer: '10000000-0000-4000-8000-000000000005',
  category: '20000000-0000-4000-8000-000000000001',
  supplier: '20000000-0000-4000-8000-000000000002',
  product: '30000000-0000-4000-8000-000000000001',
  location: '40000000-0000-4000-8000-000000000001',
  movement: '50000000-0000-4000-8000-000000000001',
  importBatch: '60000000-0000-4000-8000-000000000001',
} as const;

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(resolve(migrationsDirectory, migrationFile), 'utf8');
    await db.exec(sql);
  }
}

async function assumeIdentity(
  databaseRole: 'anon' | 'authenticated',
  userId?: string,
): Promise<void> {
  await database.exec('reset role;');
  await database.query(`select set_config('request.jwt.claim.sub', $1, false);`, [userId ?? '']);
  await database.exec(`set role ${databaseRole};`);
}

async function resetIdentity(): Promise<void> {
  await database.exec('reset role;');
  await database.query(`select set_config('request.jwt.claim.sub', '', false);`);
}

async function queryAs<T>(
  databaseRole: 'anon' | 'authenticated',
  userId: string | undefined,
  sql: string,
): Promise<readonly T[]> {
  await assumeIdentity(databaseRole, userId);
  try {
    const result = await database.query<T>(sql);
    return result.rows;
  } finally {
    await resetIdentity();
  }
}

async function execAs(
  databaseRole: 'anon' | 'authenticated',
  userId: string | undefined,
  sql: string,
): Promise<void> {
  await assumeIdentity(databaseRole, userId);
  try {
    await database.exec(sql);
  } finally {
    await resetIdentity();
  }
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
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
    create function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = pg_catalog
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table auth.users (id uuid primary key, email text);
  `);
  await database.exec(`
    insert into auth.users (id, email) values ('${ids.admin}', 'admin@example.com');
  `);
  await runMigrations(database);

  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.operator}', 'operator@example.com'),
      ('${ids.viewer}', 'viewer@example.com'),
      ('${ids.noRole}', 'norole@example.com'),
      ('${ids.inactiveViewer}', 'inactive@example.com');

    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.inactiveViewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';
    update public.profiles set is_active = false where id = '${ids.inactiveViewer}';

    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'Ingredientes', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by)
    values ('${ids.location}', 'Estoque central', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name)
    values ('${ids.supplier}', 'Fornecedor RLS');
    insert into public.products (
      id, name, sku, product_type, unit, category_id, created_by, updated_by
    ) values (
      '${ids.product}', 'Produto protegido', 'PROTECTED-001', 'RAW', 'KG',
      '${ids.category}', '${ids.admin}', '${ids.admin}'
    );
    insert into public.stock_balances (product_id, quantity)
    values ('${ids.product}', 10.000);
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, destination_location_id,
      idempotency_key, created_by
    ) values (
      '${ids.movement}', '${ids.product}', 'ADJUSTMENT_POSITIVE', 10.000, '${ids.location}',
      'rls:test:movement', '${ids.admin}'
    );
    insert into public.import_batches (
      id, source_type, source_name, file_hash, created_by
    ) values (
      '${ids.importBatch}', 'CSV', 'Legado', 'rls:test:import', '${ids.admin}'
    );
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('autenticação, roles e RLS', () => {
  it('cria profile para usuário Auth que já existia antes da migration', async () => {
    const rows = await queryAs<{ display_name: string }>(
      'authenticated',
      ids.admin,
      `select display_name from public.profiles where id = '${ids.admin}';`,
    );
    expect(rows).toEqual([{ display_name: 'admin' }]);
  });

  it('nega acesso anônimo às tabelas expostas', async () => {
    await expect(queryAs('anon', undefined, 'select id from public.products;')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('não trata authenticated nem user_metadata como autorização', async () => {
    await database.query(`select set_config('request.jwt.claims', $1, false);`, [
      JSON.stringify({ user_metadata: { role: 'ADMIN' } }),
    ]);
    const rows = await queryAs<{ id: string }>(
      'authenticated',
      ids.noRole,
      'select id from public.products;',
    );
    expect(rows).toEqual([]);
  });

  it('permite ao VIEWER consultar estoque e histórico, mas não imports', async () => {
    const balances = await queryAs<{ quantity: string }>(
      'authenticated',
      ids.viewer,
      'select quantity::text as quantity from public.stock_balances;',
    );
    const movements = await queryAs<{ id: string }>(
      'authenticated',
      ids.viewer,
      'select id from public.stock_movements;',
    );
    const imports = await queryAs<{ id: string }>(
      'authenticated',
      ids.viewer,
      'select id from public.import_batches;',
    );

    expect(balances).toEqual([{ quantity: '10.000' }]);
    expect(movements).toEqual([{ id: ids.movement }]);
    expect(imports).toEqual([]);
    await expect(
      execAs(
        'authenticated',
        ids.viewer,
        `insert into public.import_batches (
          source_type, source_name, file_hash, created_by
        ) values ('CSV', 'Viewer', 'viewer:forbidden', '${ids.viewer}');`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('permite ao STOCK_OPERATOR preparar entrada, sem liberar importação administrativa', async () => {
    await execAs(
      'authenticated',
      ids.operator,
      `insert into public.invoices (
        supplier_id, invoice_number, issued_at, created_by
      )
      select id, 'OP-001', statement_timestamp(), '${ids.operator}'
      from public.suppliers
      limit 1;`,
    );

    const imports = await queryAs<{ id: string }>(
      'authenticated',
      ids.operator,
      'select id from public.import_batches;',
    );
    expect(imports).toEqual([]);
  });

  it('permite ao ADMIN gerenciar cadastros e staging de importação', async () => {
    await execAs(
      'authenticated',
      ids.admin,
      `insert into public.categories (name, created_by, updated_by)
       values ('Categoria do admin', '${ids.admin}', '${ids.admin}');`,
    );
    await execAs(
      'authenticated',
      ids.admin,
      `insert into public.import_batches (
        source_type, source_name, file_hash, created_by
      ) values ('CSV', 'Admin', 'admin:allowed', '${ids.admin}');`,
    );

    const imports = await queryAs<{ source_name: string }>(
      'authenticated',
      ids.admin,
      `select source_name from public.import_batches where file_hash = 'admin:allowed';`,
    );
    expect(imports).toEqual([{ source_name: 'Admin' }]);
  });

  it('impede remover ou desativar o último ADMIN ativo', async () => {
    await expect(
      execAs(
        'authenticated',
        ids.admin,
        `delete from public.user_roles
         where profile_id = '${ids.admin}'
           and role_id = (select id from public.roles where code = 'ADMIN');`,
      ),
    ).rejects.toThrow(/last active ADMIN/i);
    await expect(
      execAs(
        'authenticated',
        ids.admin,
        `update public.profiles set is_active = false where id = '${ids.admin}';`,
      ),
    ).rejects.toThrow(/last active ADMIN/i);
  });

  it.each([
    ['VIEWER', ids.viewer],
    ['STOCK_OPERATOR', ids.operator],
    ['ADMIN', ids.admin],
  ])('impede %s de alterar stock_balances diretamente', async (_role, userId) => {
    await expect(
      execAs(
        'authenticated',
        userId,
        `update public.stock_balances set quantity = 999 where product_id = '${ids.product}';`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('impede até ADMIN de editar ou apagar stock_movements', async () => {
    await expect(
      execAs(
        'authenticated',
        ids.admin,
        `update public.stock_movements set reason = 'proibido' where id = '${ids.movement}';`,
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
    await expect(
      execAs(
        'authenticated',
        ids.admin,
        `delete from public.stock_movements where id = '${ids.movement}';`,
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
  });

  it('remove todo acesso quando o perfil está inativo', async () => {
    const rows = await queryAs<{ id: string }>(
      'authenticated',
      ids.inactiveViewer,
      'select id from public.products;',
    );
    expect(rows).toEqual([]);
  });

  it('mantém RLS e ao menos uma policy em todas as tabelas públicas expostas', async () => {
    const rows = await database.query<{ table_name: string; policy_count: number }>(`
      select class.relname as table_name, count(policy.polname)::int as policy_count
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_policy policy on policy.polrelid = class.oid
      where namespace.nspname = 'public'
        and class.relkind = 'r'
        and class.relrowsecurity
      group by class.relname
      order by class.relname;
    `);

    expect(rows.rows).toHaveLength(23);
    expect(rows.rows.every(({ policy_count }) => policy_count > 0)).toBe(true);
  });

  it('mantém o bucket de importação privado e acessível somente ao ADMIN', async () => {
    const bucket = await database.query<{
      public: boolean;
      file_size_limit: number;
    }>(`
      select public, file_size_limit from storage.buckets where id = 'import-files';
    `);
    expect(bucket.rows).toEqual([{ public: false, file_size_limit: 10_485_760 }]);

    const viewerObjects = await queryAs<{ name: string }>(
      'authenticated',
      ids.viewer,
      `select name from storage.objects where bucket_id = 'import-files';`,
    );
    expect(viewerObjects).toEqual([]);
    await expect(
      execAs(
        'authenticated',
        ids.viewer,
        `insert into storage.objects (bucket_id, name) values ('import-files', 'viewer.csv');`,
      ),
    ).rejects.toThrow(/row-level security/i);

    await execAs(
      'authenticated',
      ids.admin,
      `insert into storage.objects (bucket_id, name) values ('import-files', 'admin.csv');`,
    );
    const adminObjects = await queryAs<{ name: string }>(
      'authenticated',
      ids.admin,
      `select name from storage.objects where bucket_id = 'import-files';`,
    );
    expect(adminObjects).toEqual([{ name: 'admin.csv' }]);
  });

  it('protege XML de NF-e por role e pasta do proprietário', async () => {
    const bucket = await database.query<{ public: boolean; file_size_limit: number }>(`
      select public, file_size_limit from storage.buckets where id = 'invoice-xml';
    `);
    expect(bucket.rows).toEqual([{ public: false, file_size_limit: 10_485_760 }]);

    await execAs(
      'authenticated',
      ids.operator,
      `insert into storage.objects (bucket_id, name)
       values ('invoice-xml', '${ids.operator}/arquivo.xml');`,
    );
    await expect(
      execAs(
        'authenticated',
        ids.operator,
        `insert into storage.objects (bucket_id, name)
         values ('invoice-xml', '${ids.admin}/indevido.xml');`,
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      execAs(
        'authenticated',
        ids.viewer,
        `insert into storage.objects (bucket_id, name)
         values ('invoice-xml', '${ids.viewer}/viewer.xml');`,
      ),
    ).rejects.toThrow(/row-level security/i);

    expect(
      await queryAs<{ name: string }>(
        'authenticated',
        ids.operator,
        `select name from storage.objects where bucket_id = 'invoice-xml';`,
      ),
    ).toEqual([{ name: `${ids.operator}/arquivo.xml` }]);
    expect(
      await queryAs<{ name: string }>(
        'authenticated',
        ids.admin,
        `select name from storage.objects where bucket_id = 'invoice-xml';`,
      ),
    ).toEqual([{ name: `${ids.operator}/arquivo.xml` }]);
    await execAs(
      'authenticated',
      ids.operator,
      `delete from storage.objects where bucket_id = 'invoice-xml';`,
    );
    expect(
      await queryAs<{ name: string }>(
        'authenticated',
        ids.admin,
        `select name from storage.objects where bucket_id = 'invoice-xml';`,
      ),
    ).toEqual([{ name: `${ids.operator}/arquivo.xml` }]);
  });

  it('mantém PDF fiscal privado e restrito à pasta do operador', async () => {
    const bucket = await database.query<{ public: boolean; file_size_limit: number }>(`
      select public, file_size_limit from storage.buckets where id = 'invoice-pdf';
    `);
    expect(bucket.rows).toEqual([{ public: false, file_size_limit: 15_728_640 }]);

    await execAs(
      'authenticated',
      ids.operator,
      `insert into storage.objects (bucket_id, name)
       values ('invoice-pdf', '${ids.operator}/nota.pdf');`,
    );
    await expect(
      execAs(
        'authenticated',
        ids.operator,
        `insert into storage.objects (bucket_id, name)
         values ('invoice-pdf', '${ids.admin}/indevido.pdf');`,
      ),
    ).rejects.toThrow(/row-level security/i);
    expect(
      await queryAs<{ name: string }>(
        'authenticated',
        ids.viewer,
        `select name from storage.objects where bucket_id = 'invoice-pdf';`,
      ),
    ).toEqual([]);
    expect(
      await queryAs<{ name: string }>(
        'authenticated',
        ids.operator,
        `select name from storage.objects where bucket_id = 'invoice-pdf';`,
      ),
    ).toEqual([{ name: `${ids.operator}/nota.pdf` }]);
  });
});
