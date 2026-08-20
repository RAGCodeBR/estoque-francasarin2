import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: '91000000-0000-4000-8000-000000000001',
  operator: '91000000-0000-4000-8000-000000000002',
  viewer: '91000000-0000-4000-8000-000000000003',
  category: '92000000-0000-4000-8000-000000000001',
  location: '93000000-0000-4000-8000-000000000001',
  supplier: '94000000-0000-4000-8000-000000000001',
  product: '95000000-0000-4000-8000-000000000001',
  adjustmentProduct: '95000000-0000-4000-8000-000000000002',
  lossProduct: '95000000-0000-4000-8000-000000000003',
  migrationProduct: '95000000-0000-4000-8000-000000000004',
  invoice: '96000000-0000-4000-8000-000000000001',
  importBatch: '97000000-0000-4000-8000-000000000001',
  migrationBatch: '97000000-0000-4000-8000-000000000002',
} as const;

interface AuditSearchPayload {
  page: number;
  page_size: number;
  total: number;
  items: readonly Readonly<Record<string, unknown>>[];
}

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
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

async function execAs(userId: string, sql: string): Promise<void> {
  await assumeIdentity('authenticated', userId);
  try {
    await database.exec(sql);
  } finally {
    await resetIdentity();
  }
}

async function scalar(sql: string): Promise<string> {
  return (await database.query<{ value: string }>(sql)).rows[0]?.value ?? '';
}

function parsePayload(value: unknown): AuditSearchPayload {
  const payload: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Invalid audit payload');
  }
  const record = payload as Readonly<Record<string, unknown>>;
  if (
    typeof record.page !== 'number' ||
    typeof record.page_size !== 'number' ||
    typeof record.total !== 'number' ||
    !Array.isArray(record.items)
  ) {
    throw new Error('Invalid audit payload fields');
  }
  return record as unknown as AuditSearchPayload;
}

async function searchAs(userId: string, sql: string): Promise<AuditSearchPayload> {
  const rows = await queryAs<{ payload: unknown }>(userId, sql);
  return parsePayload(rows[0]?.payload);
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create function auth.uid()
    returns uuid language sql stable set search_path = pg_catalog
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    create table auth.users (id uuid primary key, email text);
  `);
  await runMigrations(database);
  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.admin}', 'audit-admin@example.com'),
      ('${ids.operator}', 'audit-operator@example.com'),
      ('${ids.viewer}', 'audit-viewer@example.com');
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'Base auditoria', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by)
    values ('${ids.location}', 'Estoque auditoria', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name, document)
    values ('${ids.supplier}', 'Fornecedor Auditoria Ltda', '12.345.678/0001-95');
    insert into public.products (
      id, name, sku, product_type, unit, category_id, created_by, updated_by
    ) values
      ('${ids.adjustmentProduct}', 'Produto ajuste auditado', 'AUDIT-ADJUST', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.lossProduct}', 'Produto perda auditada', 'AUDIT-LOSS', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.migrationProduct}', 'Produto migração auditada', 'AUDIT-MIGRATION', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}');
    insert into public.stock_balances (product_id, quantity) values
      ('${ids.adjustmentProduct}', 10), ('${ids.lossProduct}', 10);
    insert into public.import_batches (
      id, source_type, source_name, original_filename, file_hash, status, total_rows,
      valid_rows, created_by
    ) values (
      '${ids.migrationBatch}', 'CSV', 'Legado auditoria', 'abertura.csv',
      'audit-migration-hash', 'READY', 1, 1, '${ids.admin}'
    );
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('captura completa de auditoria', () => {
  it('audita criação, alteração e inativação dos dados mestres com ator e snapshots', async () => {
    await execAs(
      ids.admin,
      `insert into public.products (
        id, name, sku, product_type, unit, category_id, created_by, updated_by
      ) values (
        '${ids.product}', 'Produto auditado', 'AUDIT-PRODUCT', 'RAW', 'KG',
        '${ids.category}', '${ids.admin}', '${ids.admin}'
      );`,
    );
    await execAs(
      ids.admin,
      `update public.products set name = 'Produto alterado', updated_by = '${ids.admin}'
       where id = '${ids.product}';`,
    );
    await execAs(
      ids.admin,
      `update public.products set is_active = false, updated_by = '${ids.admin}'
       where id = '${ids.product}';`,
    );
    await execAs(
      ids.admin,
      `update public.categories set description = 'Categoria alterada', updated_by = '${ids.admin}'
       where id = '${ids.category}';`,
    );
    await execAs(
      ids.admin,
      `update public.locations set description = 'Local alterado', updated_by = '${ids.admin}'
       where id = '${ids.location}';`,
    );
    await execAs(
      ids.admin,
      `update public.suppliers set trade_name = 'Fornecedor Audit' where id = '${ids.supplier}';`,
    );

    const productActions = await database.query<{
      action: string;
      actor_id: string;
      old_name: string | null;
      new_name: string;
    }>(`
      select action, actor_id::text, old_data ->> 'name' as old_name,
             new_data ->> 'name' as new_name
      from public.audit_logs
      where entity_type = 'product' and entity_id = '${ids.product}'
      order by created_at, id;
    `);
    expect(productActions.rows.map(({ action }) => action)).toEqual([
      'PRODUCT_CREATED',
      'PRODUCT_UPDATED',
      'PRODUCT_INACTIVATED',
    ]);
    expect(productActions.rows.every(({ actor_id }) => actor_id === ids.admin)).toBe(true);
    expect(productActions.rows[1]).toMatchObject({
      old_name: 'Produto auditado',
      new_name: 'Produto alterado',
    });
    expect(
      await scalar(
        `select count(*)::text as value from public.audit_logs
         where action in ('CATEGORY_UPDATED', 'LOCATION_UPDATED', 'SUPPLIER_UPDATED')
           and actor_id = '${ids.admin}';`,
      ),
    ).toBe('3');
  });

  it('distingue movimento permanente de evento de auditoria para ajuste, perda e migração', async () => {
    await queryAs(
      ids.admin,
      `select public.adjust_stock(
        '${ids.adjustmentProduct}', 3, '${ids.location}', 'Contagem física', 'audit:adjust:1'
      );`,
    );
    await queryAs(
      ids.operator,
      `select public.register_stock_loss(
        '${ids.lossProduct}', 2, '${ids.location}', 'Produto danificado', 'Embalagem rompida',
        'audit:loss:1'
      );`,
    );
    await queryAs(
      ids.admin,
      `select public.apply_migration_opening_balance(
        '${ids.migrationProduct}', 45, '${ids.location}', '${ids.migrationBatch}',
        'audit:migration:1'
      );`,
    );

    const movements = await database.query<{ movement_type: string; quantity: string }>(`
      select movement_type::text, quantity::text from public.stock_movements
      where product_id in ('${ids.adjustmentProduct}', '${ids.lossProduct}', '${ids.migrationProduct}')
      order by movement_type;
    `);
    expect(movements.rows).toEqual([
      { movement_type: 'ADJUSTMENT_POSITIVE', quantity: '3.000' },
      { movement_type: 'LOSS', quantity: '2.000' },
      { movement_type: 'MIGRATION_OPENING_BALANCE', quantity: '45.000' },
    ]);
    const auditActions = await database.query<{ action: string }>(`
      select action from public.audit_logs
      where action in (
        'STOCK_ADJUSTMENT_CREATED', 'STOCK_LOSS_MOVEMENT_CREATED',
        'MIGRATION_OPENING_BALANCE_CREATED', 'STOCK_LOSS_REGISTERED'
      ) order by action;
    `);
    expect(auditActions.rows.map(({ action }) => action)).toEqual([
      'MIGRATION_OPENING_BALANCE_CREATED',
      'STOCK_ADJUSTMENT_CREATED',
      'STOCK_LOSS_MOVEMENT_CREATED',
      'STOCK_LOSS_REGISTERED',
    ]);
    const migrationMetadata = await database.query<{ import_batch_id: string }>(`
      select metadata ->> 'import_batch_id' as import_batch_id
      from public.audit_logs where action = 'MIGRATION_OPENING_BALANCE_CREATED';
    `);
    expect(migrationMetadata.rows).toEqual([{ import_batch_id: ids.migrationBatch }]);
  });

  it('audita NF e confirmação do import_batch com arquivo, hash, usuário, data, linhas e resultado', async () => {
    await execAs(
      ids.admin,
      `insert into public.invoices (
        id, supplier_id, invoice_number, issued_at, status, original_file_path, created_by
      ) values (
        '${ids.invoice}', '${ids.supplier}', 'AUDIT-NF-1', statement_timestamp(), 'DRAFT',
        'invoice-xml/${ids.admin}/audit.xml', '${ids.admin}'
      );`,
    );

    await database.query(`select set_config('request.jwt.claim.sub', $1, false);`, [ids.admin]);
    try {
      await database.exec(`
        insert into public.import_batches (
          id, source_type, source_name, original_filename, file_hash, status,
          total_rows, valid_rows, invalid_rows, created_by
        ) values (
          '${ids.importBatch}', 'XLSX', 'Sistema antigo', 'produtos.xlsx', 'audit-import-hash',
          'READY', 600, 598, 2, '${ids.admin}'
        );
        update public.import_batches
        set status = 'COMPLETED', confirmed_at = statement_timestamp(), confirmed_by = '${ids.admin}',
            confirmation_report = '{"products_created":598,"warnings":2,"errors":0}'::jsonb
        where id = '${ids.importBatch}';
      `);
    } finally {
      await database.query(`select set_config('request.jwt.claim.sub', '', false);`);
    }

    expect(
      await scalar(
        `select count(*)::text as value from public.audit_logs
         where action = 'INVOICE_CREATED' and entity_id = '${ids.invoice}';`,
      ),
    ).toBe('1');
    const importAudit = await database.query<{
      import_batch_id: string;
      file: string;
      file_hash: string;
      user_id: string;
      event_at: string;
      total_rows: number;
      result: Record<string, unknown>;
    }>(`
      select
        metadata ->> 'import_batch_id' as import_batch_id,
        metadata ->> 'file' as file,
        metadata ->> 'file_hash' as file_hash,
        metadata ->> 'user_id' as user_id,
        metadata ->> 'event_at' as event_at,
        (metadata ->> 'total_rows')::integer as total_rows,
        metadata -> 'result' as result
      from public.audit_logs
      where action = 'IMPORT_BATCH_CONFIRMED' and entity_id = '${ids.importBatch}';
    `);
    expect(importAudit.rows).toHaveLength(1);
    expect(importAudit.rows[0]).toMatchObject({
      import_batch_id: ids.importBatch,
      file: 'produtos.xlsx',
      file_hash: 'audit-import-hash',
      user_id: ids.admin,
      total_rows: 600,
      result: { products_created: 598, warnings: 2, errors: 0 },
    });
    expect(Date.parse(importAudit.rows[0]?.event_at ?? '')).not.toBeNaN();
  });

  it('registra exportação administrativa idempotente e nega operador', async () => {
    const sql = `select public.record_administrative_export(
      'PRODUCTS', 'XLSX', 600, 'audit:export:products:1'
    ) as report;`;
    const first = (await queryAs<{ report: Record<string, unknown> }>(ids.admin, sql))[0]?.report;
    const replay = (await queryAs<{ report: Record<string, unknown> }>(ids.admin, sql))[0]?.report;
    expect(first).toMatchObject({ applied: true });
    expect(replay).toMatchObject({ auditLogId: first?.auditLogId, applied: false });
    expect(
      await scalar(
        `select count(*)::text as value from public.audit_logs
         where action = 'ADMIN_EXPORT_COMPLETED'
           and metadata ->> 'idempotency_key' = 'audit:export:products:1';`,
      ),
    ).toBe('1');
    await expect(
      queryAs(
        ids.operator,
        `select public.record_administrative_export(
          'PRODUCTS', 'CSV', 10, 'audit:export:operator'
        );`,
      ),
    ).rejects.toThrow(/ADMIN role is required/i);
  });
});

describe('consulta, segurança e retenção dos logs', () => {
  it('rejeita senhas, tokens, service_role e connection strings em qualquer nível', async () => {
    for (const payload of [
      { token: 'abc' },
      { nested: { password: 'abc' } },
      { value: 'sb_secret_example' },
      { value: 'postgresql://admin:senha@localhost/database' },
    ]) {
      const json = JSON.stringify(payload).replaceAll("'", "''");
      await expect(
        database.exec(`
          insert into public.audit_logs (action, entity_type, metadata)
          values ('FORBIDDEN_TEST', 'security_test', '${json}'::jsonb);
        `),
      ).rejects.toThrow(/audit payload|no_secrets|forbidden credential/i);
    }
  });

  it('pagina e filtra no servidor usando índices dedicados', async () => {
    await database.exec(`
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
      select '${ids.admin}', 'PAGINATION_TEST', 'test_entity', series::text,
             jsonb_build_object('sequence', series)
      from generate_series(1, 120) series;
    `);

    const page = await searchAs(
      ids.admin,
      `select public.search_audit_logs(
        'PAGINATION_TEST', null, null, null, null, null, null, 3, 50
      ) as payload;`,
    );
    expect(page).toMatchObject({ page: 3, page_size: 50, total: 120 });
    expect(page.items).toHaveLength(20);

    const viewerPage = await searchAs(
      ids.viewer,
      `select public.search_audit_logs(
        'PAGINATION_TEST', null, null, null, null, null, null, 1, 50
      ) as payload;`,
    );
    expect(viewerPage).toMatchObject({ total: 0, items: [] });

    const indexes = await database.query<{ indexname: string }>(`
      select indexname from pg_indexes where schemaname = 'public'
        and indexname in (
          'audit_logs_action_created_at_idx', 'audit_logs_entity_created_at_idx',
          'audit_logs_actor_created_at_idx', 'audit_logs_request_created_at_idx'
        ) order by indexname;
    `);
    expect(indexes.rows).toHaveLength(4);
  });

  it('impede alteração e exclusão inclusive fora da Data API', async () => {
    const logId = await scalar(
      `select id::text as value from public.audit_logs where action = 'PAGINATION_TEST' limit 1;`,
    );
    await assumeIdentity('authenticated', ids.viewer);
    try {
      await expect(
        database.exec(`update public.audit_logs set action = 'TAMPERED' where id = '${logId}';`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetIdentity();
    }
    await expect(
      database.exec(`update public.audit_logs set action = 'TAMPERED' where id = '${logId}';`),
    ).rejects.toThrow(/audit_logs is append-only/i);
    await expect(
      database.exec(`delete from public.audit_logs where id = '${logId}';`),
    ).rejects.toThrow(/audit_logs is append-only/i);
  });
});
