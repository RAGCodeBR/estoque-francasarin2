import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: 'a3000000-0000-4000-8000-000000000001',
  operator: 'a3000000-0000-4000-8000-000000000002',
  viewer: 'a3000000-0000-4000-8000-000000000003',
  noRole: 'a3000000-0000-4000-8000-000000000004',
  category: 'a3100000-0000-4000-8000-000000000001',
  otherCategory: 'a3100000-0000-4000-8000-000000000002',
  stock: 'a3200000-0000-4000-8000-000000000001',
  kitchen: 'a3200000-0000-4000-8000-000000000002',
  supplier: 'a3300000-0000-4000-8000-000000000001',
  invoice: 'a3400000-0000-4000-8000-000000000001',
  batch: 'a3500000-0000-4000-8000-000000000001',
  rice: 'a3600000-0000-4000-8000-000000000001',
  meat: 'a3600000-0000-4000-8000-000000000002',
  salt: 'a3600000-0000-4000-8000-000000000003',
  legacy: 'a3600000-0000-4000-8000-000000000004',
  entry: 'a3700000-0000-4000-8000-000000000001',
  consumption: 'a3700000-0000-4000-8000-000000000002',
  loss: 'a3700000-0000-4000-8000-000000000003',
  opening: 'a3700000-0000-4000-8000-000000000004',
  lossRecord: 'a3800000-0000-4000-8000-000000000001',
} as const;

interface ReportPayload {
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
  readonly items: readonly Readonly<Record<string, unknown>>[];
}

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
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

async function reportAs(userId: string, expression: string): Promise<ReportPayload> {
  await assumeIdentity('authenticated', userId);
  try {
    const rows = (await database.query<{ report: unknown }>(`select ${expression} as report;`))
      .rows;
    const value = rows[0]?.report;
    const payload: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('Invalid report payload');
    }
    return payload as ReportPayload;
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
    create function auth.uid() returns uuid language sql stable set search_path = pg_catalog
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    create table auth.users (id uuid primary key, email text);
  `);
  await runMigrations(database);
  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.admin}', 'reports-admin@example.com'),
      ('${ids.operator}', 'reports-operator@example.com'),
      ('${ids.viewer}', 'reports-viewer@example.com'),
      ('${ids.noRole}', 'reports-no-role@example.com');
    update public.profiles set display_name = case id
      when '${ids.admin}' then 'Admin Relatórios'
      when '${ids.operator}' then 'Operador Relatórios'
      when '${ids.viewer}' then 'Leitor Relatórios'
      else 'Sem função' end;
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by) values
      ('${ids.category}', 'Mercearia', '${ids.admin}', '${ids.admin}'),
      ('${ids.otherCategory}', 'Outros', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.stock}', 'Estoque central', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.kitchen}', 'Cozinha principal', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name, trade_name, document)
      values ('${ids.supplier}', 'Fornecedor Relatórios Ltda.', 'Fornecedor R', '12345678000199');
    insert into public.products (
      id, name, sku, product_type, unit, category_id, minimum_quantity, created_by, updated_by
    ) values
      ('${ids.rice}', 'Arroz', 'ARR-001', 'RAW', 'KG', '${ids.category}', 5, '${ids.admin}', '${ids.admin}'),
      ('${ids.meat}', 'Carne', 'CAR-001', 'RAW', 'KG', '${ids.category}', 3, '${ids.admin}', '${ids.admin}'),
      ('${ids.salt}', 'Sal', 'SAL-001', 'RAW', 'KG', '${ids.otherCategory}', 0, '${ids.admin}', '${ids.admin}'),
      ('${ids.legacy}', 'Feijão legado', 'LEG-001', 'RAW', 'KG', '${ids.category}', 2, '${ids.admin}', '${ids.admin}');
    insert into public.stock_balances (product_id, quantity) values
      ('${ids.rice}', 7), ('${ids.meat}', 2), ('${ids.legacy}', 12);

    insert into public.invoices (
      id, supplier_id, invoice_number, series, issued_at, status, created_by
    ) values (
      '${ids.invoice}', '${ids.supplier}', '9001', '1', '2026-08-10T12:00:00Z', 'CONFIRMED', '${ids.admin}'
    );
    insert into public.invoice_items (
      invoice_id, line_number, product_id, description, quantity, unit, unit_price, total_amount
    ) values ('${ids.invoice}', 1, '${ids.rice}', 'Arroz pacote', 10, 'KG', 7.2500, 72.50);
    insert into public.import_batches (
      id, source_type, source_name, original_filename, file_hash, status, total_rows,
      valid_rows, created_by, metadata
    ) values (
      '${ids.batch}', 'XLSX', 'Sistema antigo do restaurante', 'legado.xlsx',
      'sha256:report-batch', 'COMPLETED', 1, 1, '${ids.admin}', '{"private_note":"not exposed"}'
    );
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, unit, destination_location_id, invoice_id,
      reason, idempotency_key, created_at, created_by
    ) values (
      '${ids.entry}', '${ids.rice}', 'PURCHASE_ENTRY', 10, 'KG', '${ids.stock}', '${ids.invoice}',
      'Entrada NF-e', 'report:entry', '2026-08-10T13:00:00Z', '${ids.admin}'
    );
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, unit, source_location_id, destination_location_id,
      reason, idempotency_key, created_at, created_by
    ) values (
      '${ids.consumption}', '${ids.rice}', 'CONSUMPTION_EXIT', 2.5, 'KG', '${ids.stock}', '${ids.kitchen}',
      'Produção diária', 'report:consumption', '2026-08-11T13:00:00Z', '${ids.operator}'
    );
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, unit, source_location_id,
      reason, idempotency_key, created_at, created_by
    ) values (
      '${ids.loss}', '${ids.meat}', 'LOSS', 1.25, 'KG', '${ids.stock}',
      'Validade expirada', 'report:loss', '2026-08-12T13:00:00Z', '${ids.operator}'
    );
    insert into public.stock_losses (
      id, movement_id, product_id, quantity, unit, location_id, reason, notes,
      idempotency_key, created_at, created_by
    ) values (
      '${ids.lossRecord}', '${ids.loss}', '${ids.meat}', 1.25, 'KG', '${ids.stock}',
      'Validade expirada', 'Descarte registrado', 'report:loss:record',
      '2026-08-12T13:00:00Z', '${ids.operator}'
    );
    insert into public.stock_movements (
      id, product_id, movement_type, quantity, unit, destination_location_id, import_batch_id,
      reason, idempotency_key, created_at, created_by
    ) values (
      '${ids.opening}', '${ids.legacy}', 'MIGRATION_OPENING_BALANCE', 12, 'KG', '${ids.stock}',
      '${ids.batch}', 'Migração sistema legado', 'report:migration', '2026-08-09T13:00:00Z', '${ids.admin}'
    );
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('relatórios paginados e filtrados no PostgreSQL', () => {
  it('classifica o estoque atual e filtra situação e categoria antes de paginar', async () => {
    const all = await reportAs(
      ids.viewer,
      `public.report_current_stock(null, null, null, null, null, true, 1, 25)`,
    );
    expect(all).toMatchObject({ page: 1, page_size: 25, total: 4 });
    expect(Object.fromEntries(all.items.map((item) => [item.sku, item.situation]))).toMatchObject({
      'ARR-001': 'OK',
      'CAR-001': 'BELOW_MINIMUM',
      'SAL-001': 'OUT_OF_STOCK',
      'LEG-001': 'OK',
    });
    const filtered = await reportAs(
      ids.viewer,
      `public.report_current_stock(null, '${ids.category}', null, null, 'BELOW_MINIMUM', true, 1, 1)`,
    );
    expect(filtered).toMatchObject({ total: 1 });
    expect(filtered.items[0]).toMatchObject({ product_id: ids.meat, balance: '2.000' });
  });

  it('agrega consumo por produto e local dentro do período', async () => {
    const report = await reportAs(
      ids.operator,
      `public.report_consumption('2026-08-11T00:00:00Z', '2026-08-11T23:59:59Z',
        '${ids.rice}', '${ids.category}', '${ids.kitchen}', 1, 25)`,
    );
    expect(report).toMatchObject({ total: 1 });
    expect(report.items[0]).toMatchObject({
      product_id: ids.rice,
      location_id: ids.kitchen,
      quantity: '2.500',
      unit: 'KG',
    });
  });

  it('lista perdas com motivo, local, responsável e data', async () => {
    const report = await reportAs(
      ids.viewer,
      `public.report_losses(null, null, '${ids.meat}', null, '${ids.stock}', '${ids.operator}', 1, 25)`,
    );
    expect(report).toMatchObject({ total: 1 });
    expect(report.items[0]).toMatchObject({
      product_name: 'Carne',
      quantity: '1.250',
      reason: 'Validade expirada',
      location_name: 'Estoque central',
      responsible_name: 'Operador Relatórios',
    });
  });

  it('lista somente itens de notas confirmadas com valores decimais exatos', async () => {
    const report = await reportAs(
      ids.admin,
      `public.report_entries(null, null, '${ids.supplier}', '${ids.invoice}', '${ids.rice}', null, 1, 25)`,
    );
    expect(report).toMatchObject({ total: 1 });
    expect(report.items[0]).toMatchObject({
      supplier_legal_name: 'Fornecedor Relatórios Ltda.',
      invoice_number: '9001',
      quantity: '10.000',
      unit_price: '7.2500',
      total_amount: '72.50',
    });
  });

  it('lista movimentações com origem, destino, responsável e referências', async () => {
    const report = await reportAs(
      ids.viewer,
      `public.report_stock_movements(null, null, '${ids.rice}', 'CONSUMPTION_EXIT',
        '${ids.stock}', '${ids.kitchen}', '${ids.operator}', null, 1, 25)`,
    );
    expect(report).toMatchObject({ total: 1 });
    expect(report.items[0]).toMatchObject({
      movement_type: 'CONSUMPTION_EXIT',
      source_location_name: 'Estoque central',
      destination_location_name: 'Cozinha principal',
      responsible_name: 'Operador Relatórios',
      reason: 'Produção diária',
    });
  });

  it('expõe a origem rastreável da migração sem dados internos do staging', async () => {
    const report = await reportAs(
      ids.viewer,
      `public.report_migration_opening_balances(null, null, '${ids.batch}', '${ids.legacy}',
        '${ids.category}', 'sistema antigo', 1, 25)`,
    );
    expect(report).toMatchObject({ total: 1 });
    expect(report.items[0]).toMatchObject({
      product_id: ids.legacy,
      opening_quantity: '12.000',
      import_batch_id: ids.batch,
      source_name: 'Sistema antigo do restaurante',
      origin: 'Migração sistema legado',
    });
    expect(report.items[0]).not.toHaveProperty('file_hash');
    expect(report.items[0]).not.toHaveProperty('metadata');
    expect(report.items[0]).not.toHaveProperty('original_filename');
  });
});

describe('segurança, paginação e índices de relatórios', () => {
  it('permite as três roles, bloqueia autenticado sem role e anônimo', async () => {
    for (const userId of [ids.admin, ids.operator, ids.viewer]) {
      await expect(
        reportAs(userId, `public.report_current_stock(null, null, null, null, null, true, 1, 1)`),
      ).resolves.toMatchObject({ page_size: 1 });
    }
    await expect(
      reportAs(ids.noRole, `public.report_current_stock(null, null, null, null, null, true, 1, 1)`),
    ).rejects.toThrow(/report access is not authorized/i);

    await assumeIdentity('anon');
    try {
      await expect(
        database.query(
          `select public.report_current_stock(null, null, null, null, null, true, 1, 1);`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetIdentity();
    }
  });

  it('recusa paginação excessiva e intervalo invertido no backend', async () => {
    await expect(
      reportAs(
        ids.viewer,
        `public.report_current_stock(null, null, null, null, null, true, 1, 101)`,
      ),
    ).rejects.toThrow(/invalid report pagination/i);
    await expect(
      reportAs(
        ids.viewer,
        `public.report_consumption('2026-08-20T00:00:00Z', '2026-08-01T00:00:00Z', null, null, null, 1, 25)`,
      ),
    ).rejects.toThrow(/invalid report date range/i);
  });

  it('cria os índices específicos para filtros e ordenação', async () => {
    const indexes = await database.query<{ indexname: string }>(`
      select indexname from pg_indexes where schemaname = 'public' and indexname like '%_report_idx';
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'stock_movements_type_created_at_report_idx',
        'stock_movements_destination_type_created_at_report_idx',
        'stock_movements_source_type_created_at_report_idx',
        'stock_movements_actor_created_at_report_idx',
        'stock_movements_batch_type_created_at_report_idx',
        'stock_losses_created_at_report_idx',
        'stock_losses_actor_created_at_report_idx',
        'invoices_issued_at_report_idx',
        'invoices_supplier_issued_at_report_idx',
        'invoice_items_product_invoice_report_idx',
      ]),
    );
  });
});
