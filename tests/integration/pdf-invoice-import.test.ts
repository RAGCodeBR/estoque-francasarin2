import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VALID_ACCESS_KEY } from '../fixtures/nfe-xml';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const ids = {
  admin: 'ab000000-0000-4000-8000-000000000001',
  operator: 'ab000000-0000-4000-8000-000000000002',
  viewer: 'ab000000-0000-4000-8000-000000000003',
  category: 'bc000000-0000-4000-8000-000000000001',
  stock: 'cd000000-0000-4000-8000-000000000001',
  supplier: 'de000000-0000-4000-8000-000000000001',
  product: 'ef000000-0000-4000-8000-000000000001',
  missingSupplier: 'de000000-0000-4000-8000-000000000099',
  missingProduct: 'ef000000-0000-4000-8000-000000000099',
} as const;

let database: PGlite;
let assistedImportId = '';

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

async function stagePdf(
  userId: string,
  hash: string,
  header: Readonly<Record<string, unknown>>,
  items: readonly Readonly<Record<string, unknown>>[],
): Promise<string> {
  await assumeIdentity('authenticated', userId);
  try {
    const result = await database.query<{ id: string }>(
      `
      select public.stage_pdf_invoice(
        $1, 'nota.pdf', 'invoice-pdf/teste/nota.pdf', $2::jsonb, $3::jsonb,
        '{"pageCount":1,"characterCount":200}'::jsonb,
        '{"lines":[{"page":1,"text":"extração de teste"}]}'::jsonb
      )::text as id;
    `,
      [hash, JSON.stringify(header), JSON.stringify(items)],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('PDF staging ID was not returned');
    return id;
  } finally {
    await resetIdentity();
  }
}

async function reviewPdf(
  userId: string,
  importId: string,
  header: Readonly<Record<string, unknown>>,
  items: readonly Readonly<Record<string, unknown>>[],
): Promise<string> {
  await assumeIdentity('authenticated', userId);
  try {
    const result = await database.query<{ status: string }>(
      `
      select public.review_pdf_invoice($1::uuid, $2::jsonb, $3::jsonb)::text as status;
    `,
      [importId, JSON.stringify(header), JSON.stringify(items)],
    );
    return result.rows[0]?.status ?? '';
  } finally {
    await resetIdentity();
  }
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Expected JSON object');
  return parsed as Readonly<Record<string, unknown>>;
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
      values ('${ids.category}', 'PDF', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by)
      values ('${ids.stock}', 'Estoque PDF', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name, document)
      values ('${ids.supplier}', 'Fornecedor cadastrado', '11222333000181');
    insert into public.products (
      id, name, sku, product_type, unit, category_id, created_by, updated_by
    ) values (
      '${ids.product}', 'Produto com mesmo nome do PDF', 'PDF-PROD-1',
      'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'
    );
  `);
}, 60_000);

afterAll(async () => database.close());

describe('confirmação assistida de Nota Fiscal PDF', () => {
  it('mantém campos ausentes em PENDING_REVIEW e não cria nota ou estoque', async () => {
    const importId = await stagePdf(
      ids.operator,
      'a'.repeat(64),
      {
        accessKey: null,
        invoiceNumber: null,
        series: null,
        issuedAt: null,
        supplierDocument: null,
        supplierLegalName: null,
        issues: [{ field: 'invoiceNumber', problem: 'ausente' }],
      },
      [],
    );

    const preview = jsonObject(
      (
        await queryAs<{ preview: unknown }>(
          ids.operator,
          `
      select public.get_invoice_import_preview('${importId}') as preview;
    `,
        )
      )[0]?.preview,
    );
    expect(preview.import).toMatchObject({ source_format: 'PDF', status: 'PENDING_REVIEW' });
    expect(preview.items).toEqual([]);
    expect((await database.query('select 1 from public.invoices;')).rows).toHaveLength(0);
    expect((await database.query('select 1 from public.stock_movements;')).rows).toHaveLength(0);
    await expect(
      queryAs(
        ids.operator,
        `
      select public.confirm_pdf_invoice('${importId}', '${ids.stock}', 'pdf:partial');
    `,
      ),
    ).rejects.toThrow(/human review|complete human review/i);
  });

  it('não associa por descrição e sinaliza fornecedor e produto desconhecidos', async () => {
    assistedImportId = await stagePdf(
      ids.operator,
      'b'.repeat(64),
      {
        accessKey: VALID_ACCESS_KEY,
        invoiceNumber: '9001',
        series: '1',
        issuedAt: '2026-08-20T13:15:00.000Z',
        supplierDocument: '04252011000110',
        supplierLegalName: 'Fornecedor não cadastrado',
        issues: [],
      },
      [
        {
          lineNumber: 1,
          supplierProductCode: null,
          description: 'Produto com mesmo nome do PDF',
          ean: null,
          unit: 'KG',
          quantity: '5.000',
          unitPrice: '10.0000',
          totalAmount: '50.00',
          page: 1,
          rawText: 'linha extraída',
        },
        {
          lineNumber: 2,
          supplierProductCode: null,
          description: 'Ruído da extração',
          ean: null,
          unit: null,
          quantity: null,
          unitPrice: null,
          totalAmount: null,
          page: 1,
          rawText: 'texto que não representa item válido',
        },
      ],
    );
    expect(
      await stagePdf(
        ids.operator,
        'b'.repeat(64),
        {
          accessKey: VALID_ACCESS_KEY,
          issues: [],
        },
        [],
      ),
    ).toBe(assistedImportId);

    const header = (
      await database.query<{ status: string; suggested: string | null; resolved: string | null }>(`
      select status::text, suggested_supplier_id::text as suggested,
             resolved_supplier_id::text as resolved
      from public.invoice_imports where id = '${assistedImportId}';
    `)
    ).rows[0];
    expect(header).toEqual({ status: 'PENDING_REVIEW', suggested: null, resolved: null });
    const item = (
      await database.query<{ id: string; suggested: string | null; resolved: string | null }>(`
      select id::text, suggested_product_id::text as suggested,
             resolved_product_id::text as resolved
      from public.invoice_import_items
      where invoice_import_id = '${assistedImportId}' and line_number = 1;
    `)
    ).rows[0];
    expect(item).toMatchObject({ suggested: null, resolved: null });
    expect((await database.query('select 1 from public.stock_movements;')).rows).toHaveLength(0);

    await expect(
      reviewPdf(ids.operator, assistedImportId, { supplierId: ids.missingSupplier }, []),
    ).rejects.toThrow(/supplier was not found/i);
    await expect(
      reviewPdf(ids.operator, assistedImportId, { supplierId: ids.supplier }, [
        {
          itemId: item?.id,
          lineNumber: 1,
          productId: ids.missingProduct,
          unit: 'KG',
        },
      ]),
    ).rejects.toThrow(/product with compatible unit was not found/i);
  });

  it('exige revisão humana completa antes de confirmar e usa receive_stock uma única vez', async () => {
    const items = (
      await database.query<{ id: string; line_number: number }>(`
      select id::text, line_number from public.invoice_import_items
      where invoice_import_id = '${assistedImportId}' order by line_number;
    `)
    ).rows;
    const item = items.find(({ line_number }) => line_number === 1);
    const ignoredItem = items.find(({ line_number }) => line_number === 2);
    expect(
      await reviewPdf(
        ids.operator,
        assistedImportId,
        {
          supplierId: ids.supplier,
          accessKey: VALID_ACCESS_KEY,
          invoiceNumber: '9001',
          series: '1',
          issuedAt: '2026-08-20T13:15:00.000Z',
        },
        [
          {
            itemId: item?.id,
            lineNumber: 1,
            productId: ids.product,
            description: 'Produto revisado',
            unit: 'KG',
            quantity: '5.000',
            unitPrice: '10.0000',
            totalAmount: '50.00',
          },
          { itemId: ignoredItem?.id, lineNumber: 2, ignored: true },
        ],
      ),
    ).toBe('READY');

    await expect(
      queryAs(
        ids.operator,
        `
      select public.confirm_nfe_import('${assistedImportId}', '${ids.stock}', 'wrong-source');
    `,
      ),
    ).rejects.toThrow(/XML invoice import/i);
    const first = jsonObject(
      (
        await queryAs<{ report: unknown }>(
          ids.operator,
          `
      select public.confirm_pdf_invoice('${assistedImportId}', '${ids.stock}', 'pdf:9001') as report;
    `,
        )
      )[0]?.report,
    );
    expect(first).toMatchObject({ itemsCreated: 1, movementsCreated: 1, applied: true });
    const replay = jsonObject(
      (
        await queryAs<{ report: unknown }>(
          ids.operator,
          `
      select public.confirm_pdf_invoice('${assistedImportId}', '${ids.stock}', 'pdf:9001') as report;
    `,
        )
      )[0]?.report,
    );
    expect(replay).toMatchObject({ movementsCreated: 1, applied: false });
    expect(
      (
        await database.query(
          `select quantity::text from public.stock_balances where product_id = '${ids.product}';`,
        )
      ).rows,
    ).toEqual([{ quantity: '5.000' }]);
    expect(
      (
        await database.query(
          `select 1 from public.stock_movements where idempotency_key like 'pdf:${assistedImportId}:%';`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await database.query(
          `select 1 from public.invoice_items where invoice_id = '${String(first.invoiceId)}';`,
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('impede duplicidade depois da confirmação e esconde preview do VIEWER', async () => {
    await expect(
      stagePdf(
        ids.operator,
        'c'.repeat(64),
        {
          accessKey: VALID_ACCESS_KEY,
          invoiceNumber: 'outra',
          issuedAt: '2026-08-20T13:15:00.000Z',
          supplierDocument: '11222333000181',
          supplierLegalName: 'Fornecedor',
          issues: [],
        },
        [],
      ),
    ).rejects.toThrow(/already confirmed|duplicate/i);
    expect(
      await queryAs<{ preview: unknown }>(
        ids.viewer,
        `
      select public.get_invoice_import_preview('${assistedImportId}') as preview;
    `,
      ),
    ).toEqual([{ preview: null }]);
  });
});
