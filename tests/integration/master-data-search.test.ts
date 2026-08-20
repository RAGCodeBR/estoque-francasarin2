import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: 'a7000000-0000-4000-8000-000000000001',
  viewer: 'a7000000-0000-4000-8000-000000000002',
  noRole: 'a7000000-0000-4000-8000-000000000003',
  category1: 'b7000000-0000-4000-8000-000000000001',
  location1: 'c7000000-0000-4000-8000-000000000001',
} as const;

interface SearchPayload {
  page: number;
  page_size: number;
  total: number;
  items: readonly Readonly<Record<string, unknown>>[];
}

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

function parsePayload(value: unknown): SearchPayload {
  const payload: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid search payload');
  }
  const record = payload as Readonly<Record<string, unknown>>;
  if (
    typeof record.page !== 'number' ||
    typeof record.page_size !== 'number' ||
    typeof record.total !== 'number' ||
    !Array.isArray(record.items)
  ) {
    throw new Error('Invalid search payload fields');
  }
  const items: readonly Readonly<Record<string, unknown>>[] = record.items.filter(
    (item): item is Readonly<Record<string, unknown>> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
  if (items.length !== record.items.length) throw new Error('Invalid search items');
  return {
    page: record.page,
    page_size: record.page_size,
    total: record.total,
    items,
  };
}

async function searchAs(userId: string, sql: string): Promise<SearchPayload> {
  const rows = await queryAs<{ payload: unknown }>('authenticated', userId, sql);
  return parsePayload(rows[0]?.payload);
}

async function scalar(sql: string): Promise<string> {
  const result = await database.query<{ value: string }>(sql);
  return result.rows[0]?.value ?? '';
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
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
  await runMigrations(database);

  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.admin}', 'admin-master@example.com'),
      ('${ids.viewer}', 'viewer-master@example.com'),
      ('${ids.noRole}', 'no-role-master@example.com');
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by)
    select
      ('b7000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
      'Categoria ' || lpad(series::text, 2, '0'),
      '${ids.admin}',
      '${ids.admin}'
    from generate_series(1, 5) series;

    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.location1}', 'Estoque principal', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('c7000000-0000-4000-8000-000000000002', 'Estoque auxiliar', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('c7000000-0000-4000-8000-000000000003', 'Cozinha', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');

    insert into public.products (
      name, sku, product_type, unit, category_id, minimum_quantity, created_by, updated_by
    )
    select
      'Produto ' || lpad(series::text, 4, '0'),
      'SKU-' || lpad(series::text, 4, '0'),
      case when mod(series, 2) = 0 then 'RAW'::public.product_type else 'FRACTIONATED'::public.product_type end,
      case when mod(series, 2) = 0 then 'KG'::public.unit_type else 'UN'::public.unit_type end,
      ('b7000000-0000-4000-8000-' || lpad((mod(series - 1, 5) + 1)::text, 12, '0'))::uuid,
      mod(series, 10)::numeric,
      '${ids.admin}',
      '${ids.admin}'
    from generate_series(1, 650) series;

    update public.products
    set is_active = false, updated_by = '${ids.admin}'
    where sku in (select 'SKU-' || lpad(series::text, 4, '0') from generate_series(1, 10) series);

    update public.products
    set minimum_quantity = 999999999999999.999, updated_by = '${ids.admin}'
    where sku = 'SKU-0650';

    insert into public.stock_balances (product_id, quantity)
    select id, 10 from public.products where sku = 'SKU-0001';
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('pesquisa paginada de dados mestres', () => {
  it('pagina 650 produtos no servidor e não retorna saldo no payload', async () => {
    const firstPage = await searchAs(
      ids.viewer,
      `select public.search_products(null, null, null, null, null, 1, 50) as payload;`,
    );
    expect(firstPage).toMatchObject({ page: 1, page_size: 50, total: 650 });
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.items[0]).not.toHaveProperty('quantity');
    expect(firstPage.items[0]).not.toHaveProperty('balance');

    const beyondLastPage = await searchAs(
      ids.viewer,
      `select public.search_products(null, null, null, null, null, 14, 50) as payload;`,
    );
    expect(beyondLastPage).toMatchObject({ page: 14, page_size: 50, total: 650 });
    expect(beyondLastPage.items).toEqual([]);
  });

  it('pesquisa produto por SKU e aplica filtros sem carregar todos os registros', async () => {
    const bySku = await searchAs(
      ids.viewer,
      `select public.search_products('SKU-0649', null, null, null, null, 1, 25) as payload;`,
    );
    expect(bySku.total).toBe(1);
    expect(bySku.items[0]?.sku).toBe('SKU-0649');

    const activeRawKg = await searchAs(
      ids.viewer,
      `select public.search_products(null, null, 'RAW', 'KG', true, 1, 100) as payload;`,
    );
    expect(activeRawKg.total).toBe(320);
    expect(activeRawKg.items).toHaveLength(100);

    const categoryPage = await searchAs(
      ids.viewer,
      `select public.search_products(null, '${ids.category1}', null, null, null, 1, 25) as payload;`,
    );
    expect(categoryPage.total).toBe(130);
    expect(categoryPage.items).toHaveLength(25);
  });

  it('preserva NUMERIC(18,3) como texto decimal na consulta individual', async () => {
    const productId = await scalar(
      `select id::text as value from public.products where sku = 'SKU-0650';`,
    );
    const product = await searchAs(
      ids.viewer,
      `select jsonb_build_object(
        'page', 1,
        'page_size', 1,
        'total', 1,
        'items', jsonb_build_array(public.get_product('${productId}'))
      ) as payload;`,
    );
    expect(product.items[0]?.minimum_quantity).toBe('999999999999999.999');
  });

  it('pagina categorias e filtra locais por tipo', async () => {
    const categories = await searchAs(
      ids.viewer,
      `select public.search_categories('Categoria', true, 1, 2) as payload;`,
    );
    expect(categories).toMatchObject({ total: 5, page: 1, page_size: 2 });
    expect(categories.items).toHaveLength(2);

    const locations = await searchAs(
      ids.viewer,
      `select public.search_locations(null, 'STOCK', true, 1, 25) as payload;`,
    );
    expect(locations.total).toBe(2);
    expect(locations.items).toHaveLength(2);
  });

  it('limita página a 100 e mantém RLS dentro das funções de pesquisa', async () => {
    await expect(
      searchAs(
        ids.viewer,
        `select public.search_products(null, null, null, null, null, 1, 101) as payload;`,
      ),
    ).rejects.toThrow(/page_size must be between 1 and 100/i);

    const noRole = await searchAs(
      ids.noRole,
      `select public.search_products(null, null, null, null, null, 1, 25) as payload;`,
    );
    expect(noRole).toMatchObject({ total: 0, items: [] });

    await expect(
      queryAs<{ payload: unknown }>(
        'anon',
        undefined,
        `select public.search_products(null, null, null, null, null, 1, 25) as payload;`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('mutações de dados mestres sob RLS', () => {
  it('permite CRUD lógico ao ADMIN sem modificar saldo do produto', async () => {
    const productId = await scalar(
      `select id::text as value from public.products where sku = 'SKU-0001';`,
    );
    await execAs(
      'authenticated',
      ids.admin,
      `update public.products
       set name = 'Produto editado', minimum_quantity = 5, updated_by = '${ids.admin}'
       where id = '${productId}';`,
    );
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${productId}';`,
      ),
    ).toBe('10.000');

    await execAs(
      'authenticated',
      ids.admin,
      `update public.products set is_active = true, updated_by = '${ids.admin}' where id = '${productId}';`,
    );
    expect(
      await scalar(
        `select is_active::text as value from public.products where id = '${productId}';`,
      ),
    ).toBe('true');
  });

  it('nega mutação ao VIEWER e exclusão física até ao ADMIN da Data API', async () => {
    await execAs(
      'authenticated',
      ids.viewer,
      `update public.categories set name = 'Proibido', updated_by = '${ids.viewer}' where id = '${ids.category1}';`,
    );
    expect(
      await scalar(`select name as value from public.categories where id = '${ids.category1}';`),
    ).toBe('Categoria 01');
    await expect(
      execAs(
        'authenticated',
        ids.admin,
        `delete from public.locations where id = '${ids.location1}';`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
