import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getExportDefinition } from '../../src/modules/data-export';
import type { OperationalExportType } from '../../src/modules/data-export';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const ids = {
  admin: 'c1000000-0000-4000-8000-000000000001',
  operator: 'c1000000-0000-4000-8000-000000000002',
  viewer: 'c1000000-0000-4000-8000-000000000003',
  noRole: 'c1000000-0000-4000-8000-000000000004',
  category: 'c1100000-0000-4000-8000-000000000001',
  otherCategory: 'c1100000-0000-4000-8000-000000000002',
  stock: 'c1200000-0000-4000-8000-000000000001',
  kitchen: 'c1200000-0000-4000-8000-000000000002',
  supplier: 'c1300000-0000-4000-8000-000000000001',
  rice: 'c1400000-0000-4000-8000-000000000001',
  meat: 'c1400000-0000-4000-8000-000000000002',
  inactive: 'c1400000-0000-4000-8000-000000000003',
  invoice: 'c1500000-0000-4000-8000-000000000001',
  movement: 'c1600000-0000-4000-8000-000000000001',
  lossMovement: 'c1600000-0000-4000-8000-000000000002',
  loss: 'c1700000-0000-4000-8000-000000000001',
} as const;

interface ExportPayload {
  readonly schema_version: number;
  readonly export_type: string;
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

interface AuditReceipt {
  readonly exportId: string;
  readonly applied: boolean;
}

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files)
    await db.exec(await readFile(resolve(migrationsDirectory, file), 'utf8'));
}

async function assumeIdentity(role: 'anon' | 'authenticated', userId?: string): Promise<void> {
  await database.exec('reset role;');
  await database.query(`select set_config('request.jwt.claim.sub', $1, false);`, [userId ?? '']);
  await database.exec(`set role ${role};`);
}

async function resetIdentity(): Promise<void> {
  await database.exec('reset role;');
  await database.query(`select set_config('request.jwt.claim.sub', '', false);`);
}

async function jsonAs<T>(userId: string, expression: string): Promise<T> {
  await assumeIdentity('authenticated', userId);
  try {
    const value = (await database.query<{ payload: unknown }>(`select ${expression} as payload;`))
      .rows[0]?.payload;
    const payload: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Invalid export payload');
    }
    return payload as T;
  } finally {
    await resetIdentity();
  }
}

async function exportAs(userId: string, expression: string): Promise<ExportPayload> {
  return await jsonAs<ExportPayload>(userId, expression);
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create function auth.uid() returns uuid language sql stable set search_path = pg_catalog
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    create table auth.users (id uuid primary key, email text);
  `);
  await runMigrations(database);
  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.admin}', 'export-admin@example.com'),
      ('${ids.operator}', 'export-operator@example.com'),
      ('${ids.viewer}', 'export-viewer@example.com'),
      ('${ids.noRole}', 'export-no-role@example.com');
    update public.profiles set display_name = case id
      when '${ids.admin}' then 'Admin Exportação'
      when '${ids.operator}' then 'Operador Exportação'
      else 'Leitor Exportação' end;
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, description, created_by, updated_by) values
      ('${ids.category}', 'Mercearia', 'Produtos secos', '${ids.admin}', '${ids.admin}'),
      ('${ids.otherCategory}', 'Carnes', null, '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.stock}', 'Estoque central', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.kitchen}', 'Cozinha', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name, trade_name, document)
      values ('${ids.supplier}', 'Fornecedor Operacional Ltda.', 'Fornecedor OP', '12345678000199');
    insert into public.products (
      id, name, sku, ean, product_type, unit, category_id, minimum_quantity,
      is_active, created_by, updated_by
    ) values
      ('${ids.rice}', 'Arroz agulhinha', 'ARR-001', '7891234567895', 'RAW', 'KG',
        '${ids.category}', 5, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.meat}', 'Filé de frango', 'FRA-001', null, 'FRACTIONATED', 'KG',
        '${ids.otherCategory}', 3, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.inactive}', 'Produto antigo', 'OLD-001', null, 'RAW', 'UN',
        '${ids.category}', 0, false, '${ids.admin}', '${ids.admin}');
    insert into public.stock_balances (product_id, quantity) values
      ('${ids.rice}', 45.125), ('${ids.meat}', 2.000);
    insert into public.invoices (
      id, supplier_id, access_key, invoice_number, series, issued_at, imported_at,
      status, created_by
    ) values (
      '${ids.invoice}', '${ids.supplier}', '35260812345678000199550010000090011000090010',
      '9001', '1', '2026-08-15T12:00:00Z', '2026-08-15T13:00:00Z', 'CONFIRMED', '${ids.admin}'
    );
    insert into public.invoice_items (
      invoice_id, line_number, product_id, supplier_product_code, description,
      quantity, unit, unit_price, total_amount
    ) values ('${ids.invoice}', 1, '${ids.rice}', 'FOR-ARROZ', 'Arroz agulhinha', 10, 'KG', 7.2500, 72.50);
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, unit, source_location_id,
      destination_location_id, reason, idempotency_key, created_at, created_by
    ) values (
      '${ids.movement}', '${ids.rice}', 'CONSUMPTION_EXIT', 2.500, 'KG', '${ids.stock}',
      '${ids.kitchen}', 'Produção almoço', 'export:movement', '2026-08-16T12:00:00Z', '${ids.operator}'
    );
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, unit, source_location_id,
      reason, idempotency_key, created_at, created_by
    ) values (
      '${ids.lossMovement}', '${ids.meat}', 'LOSS', 1.000, 'KG', '${ids.stock}',
      'Validade expirada', 'export:loss-movement', '2026-08-17T12:00:00Z', '${ids.operator}'
    );
    insert into public.stock_losses (
      id, movement_id, product_id, quantity, unit, location_id, reason, notes,
      idempotency_key, created_at, created_by
    ) values (
      '${ids.loss}', '${ids.lossMovement}', '${ids.meat}', 1, 'KG', '${ids.stock}',
      'Validade expirada', 'Descarte acompanhado', 'export:loss',
      '2026-08-17T12:00:00Z', '${ids.operator}'
    );
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('RPC de exportações operacionais', () => {
  it('exporta os nove conjuntos com schema versionado e identificadores humanos', async () => {
    const expectations: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
      PRODUCTS: { sku: 'ARR-001', name: 'Arroz agulhinha', category: 'Mercearia' },
      CATEGORIES: { name: 'Mercearia', description: 'Produtos secos' },
      LOCATIONS: { name: 'Cozinha', location_type: 'CONSUMPTION' },
      SUPPLIERS: { legal_name: 'Fornecedor Operacional Ltda.', trade_name: 'Fornecedor OP' },
      STOCK_CURRENT: { sku: 'ARR-001', current_quantity: '45.125', category: 'Mercearia' },
      STOCK_MOVEMENTS: {
        sku: 'ARR-001',
        product_name: 'Arroz agulhinha',
        responsible: 'Operador Exportação',
      },
      LOSSES: { sku: 'FRA-001', product_name: 'Filé de frango', location: 'Estoque central' },
      INVOICES: {
        invoice_number: '9001',
        supplier_legal_name: 'Fornecedor Operacional Ltda.',
        sku: 'ARR-001',
      },
      PRODUCTS_WITH_CURRENT_STOCK: {
        product_id: ids.rice,
        sku: 'ARR-001',
        ean: '7891234567895',
        name: 'Arroz agulhinha',
        category: 'Mercearia',
        product_type: 'RAW',
        unit: 'KG',
        current_quantity: '45.125',
        minimum_quantity: '5.000',
        active: true,
      },
    };
    for (const [type, expected] of Object.entries(expectations)) {
      const search = type === 'LOCATIONS' ? '{"search":"Cozinha"}' : '{}';
      const payload = await exportAs(
        ids.admin,
        `public.export_operational_data_page('${type}', '${search}'::jsonb, null, 1, 100)`,
      );
      expect(payload).toMatchObject({
        schema_version: 1,
        export_type: type,
        page: 1,
        page_size: 100,
      });
      expect(payload.rows).not.toHaveLength(0);
      expect(payload.rows).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
      expect(Object.keys(payload.rows[0] ?? {}).sort()).toEqual(
        getExportDefinition(type as OperationalExportType)
          .columns.map(({ key }) => key)
          .sort(),
      );
    }
  });

  it('aplica filtros, seleção específica e paginação no banco', async () => {
    const filtered = await exportAs(
      ids.admin,
      `public.export_operational_data_page(
        'PRODUCTS', '{"category_id":"${ids.category}","is_active":true}'::jsonb,
        array['${ids.rice}','${ids.meat}']::uuid[], 1, 1
      )`,
    );
    expect(filtered).toMatchObject({ total: 1, page: 1, page_size: 1 });
    expect(filtered.rows[0]).toMatchObject({ product_id: ids.rice, sku: 'ARR-001' });

    const secondPage = await exportAs(
      ids.admin,
      `public.export_operational_data_page('PRODUCTS', '{}'::jsonb, null, 2, 1)`,
    );
    expect(secondPage).toMatchObject({ total: 3, page: 2, page_size: 1 });
    expect(secondPage.rows).toHaveLength(1);

    await expect(
      exportAs(
        ids.admin,
        `public.export_operational_data_page('CATEGORIES', '{"movement_type":"LOSS"}'::jsonb, null, 1, 100)`,
      ),
    ).rejects.toThrow(/unsupported filter/i);
  });

  it('não expõe campos internos de autenticação ou secrets', async () => {
    for (const type of ['PRODUCTS', 'STOCK_MOVEMENTS', 'INVOICES']) {
      const payload = await exportAs(
        ids.admin,
        `public.export_operational_data_page('${type}', '{}'::jsonb, null, 1, 100)`,
      );
      const serialized = JSON.stringify(payload.rows).toLowerCase();
      expect(serialized).not.toMatch(
        /password|service_role|access_token|refresh_token|secret_key|connection_string/,
      );
    }
  });

  it('exige ADMIN ativo e não considera authenticated suficiente', async () => {
    for (const userId of [ids.operator, ids.viewer, ids.noRole]) {
      await expect(
        exportAs(
          userId,
          `public.export_operational_data_page('PRODUCTS', '{}'::jsonb, null, 1, 100)`,
        ),
      ).rejects.toThrow(/ADMIN role is required/i);
    }
    await assumeIdentity('anon');
    try {
      await expect(
        database.query(
          `select public.export_operational_data_page('PRODUCTS', '{}'::jsonb, null, 1, 100);`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetIdentity();
    }
  });

  it('audita todos os novos tipos com schema version 1 e idempotência', async () => {
    const types = [
      'PRODUCTS',
      'CATEGORIES',
      'LOCATIONS',
      'SUPPLIERS',
      'STOCK_CURRENT',
      'STOCK_MOVEMENTS',
      'LOSSES',
      'INVOICES',
      'PRODUCTS_WITH_CURRENT_STOCK',
    ];
    let portableReceipt: AuditReceipt | undefined;
    for (const type of types) {
      const receipt = await jsonAs<AuditReceipt>(
        ids.admin,
        `public.record_administrative_export('${type}', 'XLSX', 3, 'export:${type.toLowerCase()}:1')`,
      );
      expect(receipt).toMatchObject({ applied: true });
      if (type === 'PRODUCTS_WITH_CURRENT_STOCK') portableReceipt = receipt;
    }
    if (!portableReceipt) throw new Error('Recibo portátil ausente.');
    const replay = await jsonAs<AuditReceipt>(
      ids.admin,
      `public.record_administrative_export(
        'PRODUCTS_WITH_CURRENT_STOCK', 'XLSX', 3, 'export:products_with_current_stock:1'
      )`,
    );
    expect(replay).toMatchObject({ applied: false, exportId: portableReceipt.exportId });
    const log = await database.query<{ schema_version: string; export_type: string }>(`
      select new_data ->> 'export_schema_version' as schema_version,
             new_data ->> 'export_type' as export_type
      from public.audit_logs where action = 'ADMIN_EXPORT_COMPLETED'
        and metadata ->> 'idempotency_key' = 'export:products_with_current_stock:1';
    `);
    expect(log.rows).toEqual([{ schema_version: '1', export_type: 'PRODUCTS_WITH_CURRENT_STOCK' }]);

    const pdfReceipt = await jsonAs<AuditReceipt>(
      ids.admin,
      `public.record_administrative_export('STOCK_CURRENT', 'PDF', 3, 'export:stock:pdf:1')`,
    );
    expect(pdfReceipt).toMatchObject({ applied: true });
  });
});
