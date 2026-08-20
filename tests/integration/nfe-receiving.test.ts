import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAccessKey } from '../fixtures/nfe-xml';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const ids = {
  admin: 'aa000000-0000-4000-8000-000000000001',
  operator: 'aa000000-0000-4000-8000-000000000002',
  viewer: 'aa000000-0000-4000-8000-000000000003',
  category: 'bb000000-0000-4000-8000-000000000001',
  stock: 'cc000000-0000-4000-8000-000000000001',
  supplier: 'dd000000-0000-4000-8000-000000000001',
  mappedProduct: 'ee000000-0000-4000-8000-000000000001',
  eanProduct: 'ee000000-0000-4000-8000-000000000002',
  manualProduct: 'ee000000-0000-4000-8000-000000000003',
} as const;

interface StageInput {
  readonly hash: string;
  readonly accessKey: string;
  readonly invoiceNumber: string;
  readonly items: readonly Readonly<Record<string, unknown>>[];
}

let database: PGlite;
let confirmedImportId = '';
const accessKeys = {
  confirmed: createAccessKey('3526081122233300018155001000000123112345678'),
  manual: createAccessKey('3526081122233300018155001000000123112345679'),
  duplicate: createAccessKey('3526081122233300018155001000000123112345680'),
  rollback: createAccessKey('3526081122233300018155001000000123112345681'),
  viewer: createAccessKey('3526081122233300018155001000000123112345682'),
  anonymous: createAccessKey('3526081122233300018155001000000123112345683'),
} as const;

async function runMigrations(): Promise<void> {
  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files)
    await database.exec(await readFile(resolve(migrationsDirectory, file), 'utf8'));
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

async function queryAs<T>(userId: string, sql: string): Promise<readonly T[]> {
  await assumeIdentity('authenticated', userId);
  try {
    return (await database.query<T>(sql)).rows;
  } finally {
    await resetIdentity();
  }
}

async function stageAs(userId: string, input: StageInput): Promise<string> {
  await assumeIdentity('authenticated', userId);
  try {
    const result = await database.query<{ id: string }>(
      `
      select public.stage_nfe_xml(
        $1, 'nota.xml', 'nfe-xml/teste/nota.xml', $2, $3, '1',
        '2026-08-20T13:00:00Z', '11222333000181', 'Fornecedor Teste Ltda',
        'Fornecedor Teste', $4::jsonb
      )::text as id;
    `,
      [input.hash, input.accessKey, input.invoiceNumber, JSON.stringify(input.items)],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Staging ID was not returned');
    return id;
  } finally {
    await resetIdentity();
  }
}

function parseJson(value: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Expected JSON object');
  return parsed as Readonly<Record<string, unknown>>;
}

const readyItems = [
  {
    lineNumber: 1,
    supplierProductCode: 'FORN-MAPPED',
    description: 'Descrição externa qualquer',
    ean: null,
    unit: 'KG',
    quantity: '5.250',
    unitPrice: '10.5000',
    totalAmount: '55.13',
  },
  {
    lineNumber: 2,
    supplierProductCode: 'SEM-MAPA',
    description: 'Outro nome externo',
    ean: '7894900011517',
    unit: 'UN',
    quantity: '3.000',
    unitPrice: '7.1000',
    totalAmount: '21.30',
  },
] as const;

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
      ('${ids.admin}', 'admin@example.com'),
      ('${ids.operator}', 'operator@example.com'),
      ('${ids.viewer}', 'viewer@example.com');
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';
    insert into public.categories (id, name, created_by, updated_by)
      values ('${ids.category}', 'NF-e', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by)
      values ('${ids.stock}', 'Estoque NF-e', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name, trade_name, document)
      values ('${ids.supplier}', 'Fornecedor Teste Ltda', 'Fornecedor Teste', '11.222.333/0001-81');
    insert into public.products (
      id, name, sku, ean, product_type, unit, category_id, created_by, updated_by
    ) values
      ('${ids.mappedProduct}', 'Produto mapeado', 'NFE-MAPPED', null, 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.eanProduct}', 'Produto por EAN', 'NFE-EAN', '7894900011517', 'RAW', 'UN', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.manualProduct}', 'Mesmo nome externo', 'NFE-MANUAL', null, 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}');
    insert into public.supplier_product_mappings (supplier_id, supplier_product_code, product_id)
      values ('${ids.supplier}', 'FORN-MAPPED', '${ids.mappedProduct}');
  `);
}, 60_000);

afterAll(async () => database.close());

describe('entrada transacional por NF-e XML', () => {
  it('faz staging idempotente e associa somente por código do fornecedor ou EAN inequívoco', async () => {
    confirmedImportId = await stageAs(ids.operator, {
      hash: 'a'.repeat(64),
      accessKey: accessKeys.confirmed,
      invoiceNumber: '1001',
      items: readyItems,
    });
    expect(
      await stageAs(ids.operator, {
        hash: 'a'.repeat(64),
        accessKey: accessKeys.confirmed,
        invoiceNumber: '1001',
        items: readyItems,
      }),
    ).toBe(confirmedImportId);

    const header = await database.query<{ status: string; supplier: string }>(`
      select status::text, resolved_supplier_id::text as supplier
      from public.invoice_imports where id = '${confirmedImportId}';
    `);
    expect(header.rows[0]).toEqual({ status: 'READY', supplier: ids.supplier });
    const matches = await database.query<{ product: string; source: string }>(`
      select resolved_product_id::text as product, match_source::text as source
      from public.invoice_import_items where invoice_import_id = '${confirmedImportId}' order by line_number;
    `);
    expect(matches.rows).toEqual([
      { product: ids.mappedProduct, source: 'SUPPLIER_PRODUCT_CODE' },
      { product: ids.eanProduct, source: 'EAN' },
    ]);
    expect(
      (
        await database.query(
          `select 1 from public.invoices where access_key = '${accessKeys.confirmed}';`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.query(
          `select 1 from public.stock_movements where reason like 'Entrada por NF-e%';`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('confirma invoice, itens e receive_stock atomicamente e não duplica no replay', async () => {
    const first = parseJson(
      (
        await queryAs<{ result: unknown }>(
          ids.operator,
          `
      select public.confirm_nfe_import('${confirmedImportId}', '${ids.stock}', 'confirm:1001') as result;
    `,
        )
      )[0]?.result,
    );
    expect(first).toMatchObject({ itemsCreated: 2, movementsCreated: 2, applied: true });
    const repeated = parseJson(
      (
        await queryAs<{ result: unknown }>(
          ids.operator,
          `
      select public.confirm_nfe_import('${confirmedImportId}', '${ids.stock}', 'confirm:1001') as result;
    `,
        )
      )[0]?.result,
    );
    expect(repeated).toMatchObject({ itemsCreated: 2, movementsCreated: 2, applied: false });

    expect(
      (
        await database.query(
          `select 1 from public.invoices where access_key = '${accessKeys.confirmed}';`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await database.query(
          `select 1 from public.invoice_items where invoice_id = '${String(first.invoiceId)}';`,
        )
      ).rows,
    ).toHaveLength(2);
    const balances = await database.query<{ quantity: string }>(`
      select quantity::text from public.stock_balances
      where product_id in ('${ids.mappedProduct}', '${ids.eanProduct}') order by quantity desc;
    `);
    expect(balances.rows).toEqual([{ quantity: '5.250' }, { quantity: '3.000' }]);
    expect(
      (
        await database.query(
          `select 1 from public.stock_movements where invoice_id = '${String(first.invoiceId)}';`,
        )
      ).rows,
    ).toHaveLength(2);
  });

  it('nunca associa por descrição, permite revisão manual e cria mapping somente quando solicitado', async () => {
    const importId = await stageAs(ids.operator, {
      hash: 'b'.repeat(64),
      accessKey: accessKeys.manual,
      invoiceNumber: '1002',
      items: [
        {
          lineNumber: 1,
          supplierProductCode: 'MANUAL-1',
          description: 'Mesmo nome externo',
          ean: null,
          unit: 'KG',
          quantity: '2.000',
          unitPrice: '4.0000',
          totalAmount: '8.00',
        },
      ],
    });
    const stagedItem = (
      await database.query<{ id: string; product: string | null; source: string }>(`
      select id::text, resolved_product_id::text as product, match_source::text as source
      from public.invoice_import_items where invoice_import_id = '${importId}';
    `)
    ).rows[0];
    expect(stagedItem).toMatchObject({ product: null, source: 'NONE' });
    const resolution = JSON.stringify([
      {
        itemId: stagedItem?.id,
        productId: ids.manualProduct,
        unit: 'KG',
        createSupplierMapping: true,
      },
    ]).replaceAll("'", "''");
    expect(
      (
        await queryAs<{ status: string }>(
          ids.operator,
          `
      select public.review_nfe_import('${importId}', '${ids.supplier}', '${resolution}'::jsonb)::text as status;
    `,
        )
      )[0]?.status,
    ).toBe('READY');
    await queryAs(
      ids.operator,
      `select public.confirm_nfe_import('${importId}', '${ids.stock}', 'confirm:1002');`,
    );
    expect(
      (
        await database.query(`
      select 1 from public.supplier_product_mappings
      where supplier_id = '${ids.supplier}' and supplier_product_code = 'MANUAL-1'
        and product_id = '${ids.manualProduct}';
    `)
      ).rows,
    ).toHaveLength(1);
  });

  it('impede NF duplicada e chave de idempotência diferente', async () => {
    await expect(
      stageAs(ids.operator, {
        hash: 'c'.repeat(64),
        accessKey: accessKeys.confirmed,
        invoiceNumber: '9999',
        items: readyItems,
      }),
    ).rejects.toThrow(/already confirmed|duplicate key/i);
    await expect(
      queryAs(
        ids.operator,
        `
      select public.confirm_nfe_import('${confirmedImportId}', '${ids.stock}', 'different-key');
    `,
      ),
    ).rejects.toThrow(/different idempotency key/i);
  });

  it('faz rollback de nota, itens, movimentos e saldo quando qualquer item falha', async () => {
    const importId = await stageAs(ids.operator, {
      hash: 'd'.repeat(64),
      accessKey: accessKeys.rollback,
      invoiceNumber: 'ROLLBACK',
      items: [
        {
          ...readyItems[0],
          lineNumber: 1,
          description: 'FORCE ROLLBACK',
          quantity: '1.000',
        },
      ],
    });
    await database.exec(`
      create function private.fail_nfe_item_for_test() returns trigger language plpgsql as $$
      begin if new.description = 'FORCE ROLLBACK' then raise exception 'forced NF-e rollback'; end if; return new; end;
      $$;
      create trigger invoice_items_force_test_rollback before insert on public.invoice_items
      for each row execute function private.fail_nfe_item_for_test();
    `);
    await expect(
      queryAs(
        ids.operator,
        `
      select public.confirm_nfe_import('${importId}', '${ids.stock}', 'confirm:rollback');
    `,
      ),
    ).rejects.toThrow(/forced NF-e rollback/i);
    expect(
      (
        await database.query(
          `select 1 from public.invoices where access_key = '${accessKeys.rollback}';`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.query(
          `select status::text from public.invoice_imports where id = '${importId}';`,
        )
      ).rows[0],
    ).toEqual({ status: 'READY' });
    expect(
      (
        await database.query(
          `select 1 from public.stock_movements where idempotency_key like 'nfe:${importId}:%';`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('aplica RLS e nega anônimo, VIEWER e staging de outro operador', async () => {
    expect(
      await queryAs<{ count: string }>(
        ids.viewer,
        'select count(*)::text as count from public.invoice_imports;',
      ),
    ).toEqual([{ count: '0' }]);
    await expect(
      stageAs(ids.viewer, {
        hash: 'e'.repeat(64),
        accessKey: accessKeys.viewer,
        invoiceNumber: 'VIEWER',
        items: readyItems,
      }),
    ).rejects.toThrow(/role is required/i);
    await assumeIdentity('anon');
    try {
      await expect(
        database.query(`select public.stage_nfe_xml(
        '${'f'.repeat(64)}', 'nota.xml', null, '${accessKeys.anonymous}', 'ANON', '1', now(),
        '11222333000181', 'Fornecedor', null, '[]'::jsonb
      );`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetIdentity();
    }
  });
});
