import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const ids = {
  admin: 'a1500000-0000-4000-8000-000000000001',
  operator: 'a1500000-0000-4000-8000-000000000002',
  category: 'a1500000-0000-4000-8000-000000000003',
  location: 'a1500000-0000-4000-8000-000000000004',
  productA: 'a1500000-0000-4000-8000-000000000005',
  productB: 'a1500000-0000-4000-8000-000000000006',
} as const;

let database: PGlite;

async function runMigrations(): Promise<void> {
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    await database.exec(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
}

async function identity(role: 'anon' | 'authenticated', userId?: string): Promise<void> {
  await database.exec('reset role;');
  await database.query(`select set_config('request.jwt.claim.sub', $1, false);`, [userId ?? '']);
  await database.exec(`set role ${role};`);
}

async function root(): Promise<void> {
  await database.exec('reset role;');
  await database.query(`select set_config('request.jwt.claim.sub', '', false);`);
}

async function stageReconciliation(hash: string, values: readonly [string, string][]) {
  const rows = values.map(([sku, quantity], index) => ({
    rowNumber: index + 2,
    rawData: { SKU: sku, QUANTIDADE_ATUAL: quantity },
    normalizedData: { sku, current_quantity: quantity },
    validationErrors: [],
    ignored: false,
  }));
  const result = await database.query<{
    batch_id: string;
    status: string;
    summary: Record<string, number>;
  }>(
    `select * from public.stage_operational_import_preview(
      'STOCK_RECONCILIATION', 'CSV', 'Contagem operacional', 'saldo.csv', $1, 100,
      '["SKU","QUANTIDADE_ATUAL"]'::jsonb,
      '[{"sourceColumn":"SKU","targetField":"sku"},{"sourceColumn":"QUANTIDADE_ATUAL","targetField":"current_quantity"}]'::jsonb,
      $2::jsonb, null
    );`,
    [hash, JSON.stringify(rows)],
  );
  const item = result.rows[0];
  if (!item) throw new Error('batch not staged');
  return item;
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable set search_path = pg_catalog as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table auth.users (id uuid primary key, email text);
  `);
  await runMigrations();
  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.admin}', 'operational-admin@example.com'),
      ('${ids.operator}', 'operational-operator@example.com');
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.categories (id, name, created_by, updated_by)
      values ('${ids.category}', 'Operacional', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by)
      values ('${ids.location}', 'Estoque operacional', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.products (id, name, sku, product_type, unit, category_id, created_by, updated_by) values
      ('${ids.productA}', 'Produto A', 'OPER-A', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.productB}', 'Produto B', 'OPER-B', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}');
    insert into public.stock_balances (product_id, quantity) values
      ('${ids.productA}', 10.000), ('${ids.productB}', 8.000);
  `);
}, 60_000);

afterAll(async () => database.close());

describe('importações operacionais no banco', () => {
  it('executa o dry-run do wizard no staging e confirma saldo inicial pelo motor', async () => {
    await identity('authenticated', ids.admin);
    try {
      const rows = [
        {
          rowNumber: 2,
          rawData: {
            CODIGO: 'LEG-UI-1',
            DESCRICAO: 'Produto legado da interface',
            SALDO: '4,5',
            UNIDADE: 'KG',
            GRUPO: 'Categoria wizard',
            TIPO: 'RAW',
          },
          normalizedData: {
            sku: 'LEG-UI-1',
            name: 'Produto legado da interface',
            ean: null,
            external_id: 'LEGACY-UI-1',
            opening_quantity: '4.500',
            minimum_quantity: '1.000',
            unit: 'KG',
            category: 'Categoria wizard',
            product_type: 'RAW',
          },
          validationErrors: [],
          ignored: false,
        },
      ];
      const staged = await database.query<{
        batch_id: string;
        status: string;
        summary: Record<string, number>;
      }>(
        `select * from public.stage_product_import_preview(
          'INITIAL_MIGRATION', 'CSV', 'Sistema legado UI', 'produtos-ui.csv',
          'product-wizard:initial', 240,
          '["CODIGO","DESCRICAO","SALDO","UNIDADE","GRUPO","TIPO"]',
          '[
            {"sourceColumn":"CODIGO","targetField":"sku"},
            {"sourceColumn":"DESCRICAO","targetField":"name"},
            {"sourceColumn":"SALDO","targetField":"opening_quantity"},
            {"sourceColumn":"UNIDADE","targetField":"unit"},
            {"sourceColumn":"GRUPO","targetField":"category"},
            {"sourceColumn":"TIPO","targetField":"product_type"}
          ]', '{}', $1::jsonb, null
        );`,
        [JSON.stringify(rows)],
      );
      const batch = staged.rows[0];
      expect(batch?.status).toBe('PENDING_MAPPING');
      expect(batch?.summary).toMatchObject({
        TOTAL: 1,
        NEW: 1,
        WARNING: 1,
        CATEGORIES_NEW: 1,
        CONFLICT: 0,
      });
      const batchId = batch?.batch_id ?? '';

      const before = await database.query<{ count: string }>(
        `select count(*)::text from public.products where sku = 'LEG-UI-1';`,
      );
      expect(before.rows[0]?.count).toBe('0');

      const page = await database.query<{
        batch_id: string;
        total_rows: number;
        row_number: number;
        action: string;
      }>(
        `select
          preview ->> 'batch_id' as batch_id,
          (preview ->> 'total_rows')::integer as total_rows,
          (preview -> 'rows' -> 0 ->> 'rowNumber')::integer as row_number,
          preview -> 'rows' -> 0 ->> 'action' as action
        from (select public.get_product_import_preview($1, 1, 100) as preview) result;`,
        [batchId],
      );
      expect(page.rows[0]).toEqual({
        batch_id: batchId,
        total_rows: 1,
        row_number: 2,
        action: 'NEW',
      });

      const resolved = await database.query<{ invalid: number; conflict: number }>(
        `select
          (resolved -> 'summary' ->> 'INVALID')::integer as invalid,
          (resolved -> 'summary' ->> 'CONFLICT')::integer as conflict
        from (
          select public.resolve_operational_import(
            $1, '[]', '["Categoria wizard"]'
          ) as resolved
        ) result;`,
        [batchId],
      );
      expect(resolved.rows[0]).toEqual({ invalid: 0, conflict: 0 });

      const confirmed = await database.query<{
        products_created: number;
        categories_created: number;
        movements_created: number;
      }>(
        `select * from public.confirm_product_import(
          $1, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', $2, null
        );`,
        [batchId, ids.location],
      );
      expect(confirmed.rows[0]).toMatchObject({
        products_created: 1,
        categories_created: 1,
        movements_created: 1,
      });

      const movement = await database.query<{
        movement_type: string;
        quantity: string;
        import_batch_id: string;
      }>(
        `select movement_type::text, quantity::text, import_batch_id::text
         from public.stock_movements where import_batch_id = $1;`,
        [batchId],
      );
      expect(movement.rows).toEqual([
        {
          movement_type: 'MIGRATION_OPENING_BALANCE',
          quantity: '4.500',
          import_batch_id: batchId,
        },
      ]);
    } finally {
      await root();
    }
  });

  it('recusa saldo no modo cadastral e bloqueia usuário não administrador no wizard', async () => {
    const rows = [
      {
        rowNumber: 2,
        rawData: { SKU: 'WIZ-1', SALDO: '1' },
        normalizedData: {
          sku: 'WIZ-1',
          name: 'Wizard',
          opening_quantity: '1.000',
          minimum_quantity: null,
          unit: 'UN',
          category: 'Operacional',
          product_type: 'RAW',
        },
        validationErrors: [],
        ignored: false,
      },
    ];
    const sql = `select * from public.stage_product_import_preview(
      'MASTER_DATA_IMPORT', 'CSV', 'Cadastro', 'wizard.csv', $1, 100,
      '["SKU","NOME","SALDO","UNIDADE","CATEGORIA","TIPO"]',
      '[
        {"sourceColumn":"SKU","targetField":"sku"},
        {"sourceColumn":"NOME","targetField":"name"},
        {"sourceColumn":"SALDO","targetField":"opening_quantity"},
        {"sourceColumn":"UNIDADE","targetField":"unit"},
        {"sourceColumn":"CATEGORIA","targetField":"category"},
        {"sourceColumn":"TIPO","targetField":"product_type"}
      ]', '{}', $2::jsonb, null
    );`;

    await identity('authenticated', ids.admin);
    try {
      await expect(
        database.query(sql, ['product-wizard:master-quantity', JSON.stringify(rows)]),
      ).rejects.toThrow(/quantity is forbidden/);
    } finally {
      await root();
    }

    await identity('authenticated', ids.operator);
    try {
      await expect(
        database.query(sql, ['product-wizard:operator', JSON.stringify(rows)]),
      ).rejects.toThrow(/ADMIN/);
    } finally {
      await root();
    }
  });

  it('reconcilia por ajustes atômicos, rastreáveis e idempotentes', async () => {
    await identity('authenticated', ids.admin);
    try {
      const staged = await stageReconciliation('operational:reconcile:success', [
        ['OPER-A', '12.000'],
        ['OPER-B', '6.000'],
      ]);
      expect(staged.status).toBe('READY');
      expect(staged.summary).toMatchObject({ POSITIVE: 1, NEGATIVE: 1, CONFLICT: 0 });

      const confirmed = await database.query<{ applied: boolean; movements_created: number }>(
        `select * from public.confirm_stock_reconciliation_import($1, $2, 'Reconciliação via importação', 'reconcile-success');`,
        [staged.batch_id, ids.location],
      );
      expect(confirmed.rows[0]).toMatchObject({ applied: true, movements_created: 2 });

      const balances = await database.query<{ sku: string; quantity: string }>(`
        select product.sku, balance.quantity::text from public.products product
        join public.stock_balances balance on balance.product_id = product.id
        where product.id in ('${ids.productA}', '${ids.productB}') order by product.sku;
      `);
      expect(balances.rows).toEqual([
        { sku: 'OPER-A', quantity: '12.000' },
        { sku: 'OPER-B', quantity: '6.000' },
      ]);

      const movements = await database.query<{
        movement_type: string;
        reason: string;
        import_batch_id: string;
      }>(
        `select movement_type::text, reason, import_batch_id::text from public.stock_movements where import_batch_id = $1 order by movement_type;`,
        [staged.batch_id],
      );
      expect(movements.rows).toEqual([
        {
          movement_type: 'ADJUSTMENT_NEGATIVE',
          reason: 'Reconciliação via importação',
          import_batch_id: staged.batch_id,
        },
        {
          movement_type: 'ADJUSTMENT_POSITIVE',
          reason: 'Reconciliação via importação',
          import_batch_id: staged.batch_id,
        },
      ]);

      const repeated = await database.query<{ applied: boolean; movements_created: number }>(
        `select * from public.confirm_stock_reconciliation_import($1, $2, 'Reconciliação via importação', 'reconcile-success');`,
        [staged.batch_id, ids.location],
      );
      expect(repeated.rows[0]).toMatchObject({ applied: false, movements_created: 2 });
    } finally {
      await root();
    }
  });

  it('aborta sem movimento quando o saldo muda após o preview', async () => {
    await identity('authenticated', ids.admin);
    try {
      const staged = await stageReconciliation('operational:reconcile:stale', [
        ['OPER-A', '13.000'],
      ]);
      await database.query(
        `select * from public.adjust_stock($1, 1.000, $2, 'Mudança concorrente', 'operational-stale-change');`,
        [ids.productA, ids.location],
      );
      await expect(
        database.query(
          `select * from public.confirm_stock_reconciliation_import($1, $2, 'Reconciliação via importação', 'reconcile-stale');`,
          [staged.batch_id, ids.location],
        ),
      ).rejects.toThrow(/stock changed after preview/);
      const count = await database.query<{ count: string }>(
        `select count(*)::text from public.stock_movements where import_batch_id = $1;`,
        [staged.batch_id],
      );
      expect(count.rows[0]?.count).toBe('0');
    } finally {
      await root();
    }
  });

  it('confirma categorias sem tocar o estoque', async () => {
    await identity('authenticated', ids.admin);
    try {
      const rows = [
        {
          rowNumber: 2,
          rawData: { CATEGORIA: 'Bebidas' },
          normalizedData: { name: 'Bebidas', description: 'Operacional' },
          validationErrors: [],
          ignored: false,
        },
      ];
      const staged = await database.query<{ batch_id: string }>(
        `select batch_id from public.stage_operational_import_preview(
          'CATEGORIES', 'CSV', 'Cadastro futuro', 'categorias.csv', 'operational:categories', 80,
          '["CATEGORIA"]', '[{"sourceColumn":"CATEGORIA","targetField":"name"}]', $1::jsonb, null
        );`,
        [JSON.stringify(rows)],
      );
      const batchId = staged.rows[0]?.batch_id ?? '';
      const result = await database.query<{ created: number; movements_created: number }>(
        `select * from public.confirm_operational_master_data_import($1, false, 'categories-confirm');`,
        [batchId],
      );
      expect(result.rows[0]).toMatchObject({ created: 1, movements_created: 0 });
      const category = await database.query<{ name: string }>(
        `select name from public.categories where name = 'Bebidas';`,
      );
      expect(category.rows).toHaveLength(1);
    } finally {
      await root();
    }
  });

  it('recusa operador e bloqueia quantidade em importação de cadastro', async () => {
    await identity('authenticated', ids.operator);
    try {
      await expect(
        stageReconciliation('operational:unauthorized', [['OPER-A', '1.000']]),
      ).rejects.toThrow(/ADMIN/);
    } finally {
      await root();
    }

    await identity('authenticated', ids.admin);
    try {
      await expect(
        database.query(`select * from public.stage_operational_import_preview(
        'PRODUCTS', 'CSV', 'Cadastro', 'produtos.csv', 'operational:forbidden-quantity', 90,
        '["SKU","QUANTIDADE_ATUAL"]',
        '[{"sourceColumn":"SKU","targetField":"sku"},{"sourceColumn":"QUANTIDADE_ATUAL","targetField":"current_quantity"}]',
        '[{"rowNumber":2,"rawData":{"SKU":"A","QUANTIDADE_ATUAL":"1"},"normalizedData":{"sku":"A","current_quantity":"1.000"},"validationErrors":[],"ignored":false}]', null
      );`),
      ).rejects.toThrow(/not allowed|stock quantity is forbidden/);
    } finally {
      await root();
    }
  });
});
