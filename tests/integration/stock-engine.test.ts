import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  operator: 'a0000000-0000-4000-8000-000000000002',
  viewer: 'a0000000-0000-4000-8000-000000000003',
  noRole: 'a0000000-0000-4000-8000-000000000004',
  category: 'b0000000-0000-4000-8000-000000000001',
  stockA: 'c0000000-0000-4000-8000-000000000001',
  stockB: 'c0000000-0000-4000-8000-000000000002',
  consumption: 'c0000000-0000-4000-8000-000000000003',
  importBatch: 'd0000000-0000-4000-8000-000000000001',
  entryProduct: 'e0000000-0000-4000-8000-000000000001',
  consumeProduct: 'e0000000-0000-4000-8000-000000000002',
  lossProduct: 'e0000000-0000-4000-8000-000000000003',
  adjustProduct: 'e0000000-0000-4000-8000-000000000004',
  openingProduct: 'e0000000-0000-4000-8000-000000000005',
  transferProduct: 'e0000000-0000-4000-8000-000000000006',
  concurrencyProduct: 'e0000000-0000-4000-8000-000000000007',
  idempotencyProduct: 'e0000000-0000-4000-8000-000000000008',
  rollbackProduct: 'e0000000-0000-4000-8000-000000000009',
  negativeProduct: 'e0000000-0000-4000-8000-000000000010',
  unauthorizedProduct: 'e0000000-0000-4000-8000-000000000011',
  legacyKeyProduct: 'e0000000-0000-4000-8000-000000000012',
} as const;

interface StockResult {
  movement_id: string;
  new_balance: string;
  applied: boolean;
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

async function queryAs<T>(userId: string, sql: string): Promise<readonly T[]> {
  await assumeIdentity('authenticated', userId);
  try {
    const result = await database.query<T>(sql);
    return result.rows;
  } finally {
    await resetIdentity();
  }
}

async function scalar(sql: string): Promise<string> {
  const result = await database.query<{ value: string }>(sql);
  return result.rows[0]?.value ?? '';
}

function onlyResult<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const result = rows[0];
  if (result === undefined) {
    throw new Error('Expected exactly one database result');
  }
  return result;
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
      ('${ids.admin}', 'admin@example.com'),
      ('${ids.operator}', 'operator@example.com'),
      ('${ids.viewer}', 'viewer@example.com'),
      ('${ids.noRole}', 'no-role@example.com');

    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'Motor de estoque', '${ids.admin}', '${ids.admin}');

    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.stockA}', 'Estoque A', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.stockB}', 'Estoque B', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.consumption}', 'Cozinha', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');

    insert into public.import_batches (
      id, source_type, source_name, file_hash, status, created_by
    ) values (
      '${ids.importBatch}', 'CSV', 'Sistema legado', 'stock-engine:opening', 'READY', '${ids.admin}'
    );

    insert into public.products (
      id, name, sku, product_type, unit, category_id, created_by, updated_by
    ) values
      ('${ids.entryProduct}', 'Entrada', 'ENGINE-ENTRY', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.consumeProduct}', 'Consumo', 'ENGINE-CONSUME', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.lossProduct}', 'Perda', 'ENGINE-LOSS', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.adjustProduct}', 'Ajuste', 'ENGINE-ADJUST', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.openingProduct}', 'Saldo inicial', 'ENGINE-OPENING', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.transferProduct}', 'Transferência', 'ENGINE-TRANSFER', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.concurrencyProduct}', 'Concorrência', 'ENGINE-CONCURRENCY', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.idempotencyProduct}', 'Idempotência', 'ENGINE-IDEMPOTENCY', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.rollbackProduct}', 'Rollback', 'ENGINE-ROLLBACK', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.negativeProduct}', 'Negativo', 'ENGINE-NEGATIVE', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.unauthorizedProduct}', 'Sem autorização', 'ENGINE-UNAUTHORIZED', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.legacyKeyProduct}', 'Chave histórica', 'ENGINE-LEGACY-KEY', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}');

    insert into public.stock_balances (product_id, quantity) values
      ('${ids.consumeProduct}', 10.000),
      ('${ids.lossProduct}', 10.000),
      ('${ids.adjustProduct}', 10.000),
      ('${ids.transferProduct}', 10.000),
      ('${ids.concurrencyProduct}', 10.000),
      ('${ids.negativeProduct}', 3.000),
      ('${ids.unauthorizedProduct}', 5.000);

    insert into public.stock_movements (
      product_id, movement_type, quantity, destination_location_id, reason,
      idempotency_key, created_by
    ) values (
      '${ids.legacyKeyProduct}', 'PURCHASE_ENTRY', 1, '${ids.stockA}',
      'Recebimento de estoque', 'legacy:key:1', '${ids.operator}'
    );

    create function private.fail_rollback_product_balance()
    returns trigger
    language plpgsql
    set search_path = pg_catalog
    as $$
    begin
      if new.product_id = '${ids.rollbackProduct}'::uuid then
        raise exception 'forced balance update failure';
      end if;
      return new;
    end;
    $$;

    create trigger stock_balances_force_test_rollback
    before update on public.stock_balances
    for each row execute function private.fail_rollback_product_balance();
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('motor transacional de estoque', () => {
  it('recebe estoque e vincula movimento, saldo e auditoria atomicamente', async () => {
    const rows = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.receive_stock(
         '${ids.entryProduct}', 5.250, '${ids.stockA}', 'receive:entry:1'
       );`,
    );

    const result = onlyResult(rows);
    expect(result).toMatchObject({ new_balance: '5.250', applied: true });
    const movementId = result.movement_id;
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.entryProduct}';`,
      ),
    ).toBe('5.250');
    expect(
      await scalar(
        `select last_movement_id::text as value from public.stock_balances where product_id = '${ids.entryProduct}';`,
      ),
    ).toBe(movementId);
    expect(
      await scalar(
        `select count(*)::text as value from public.audit_logs where entity_id = '${movementId}';`,
      ),
    ).toBe('1');
  });

  it('consome estoque sem permitir divergência entre movimento e saldo', async () => {
    const rows = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.consume_stock(
         '${ids.consumeProduct}', 4, '${ids.stockA}', 'consume:1', '${ids.consumption}'
       );`,
    );

    const result = onlyResult(rows);
    expect(result).toMatchObject({ new_balance: '6.000', applied: true });
    expect(
      await scalar(
        `select movement_type::text as value from public.stock_movements where id = '${result.movement_id}';`,
      ),
    ).toBe('CONSUMPTION_EXIT');
  });

  it('registra perda com motivo obrigatório', async () => {
    const rows = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.register_loss(
         '${ids.lossProduct}', 2.500, '${ids.stockA}', 'Produto vencido', 'loss:1'
       );`,
    );
    const result = onlyResult(rows);
    expect(result).toMatchObject({ new_balance: '7.500', applied: true });
    expect(
      await scalar(
        `select reason as value from public.stock_movements where id = '${result.movement_id}';`,
      ),
    ).toBe('Produto vencido');
  });

  it('cria ajustes administrativos positivos e negativos, inclusive compensação referenciada', async () => {
    const positive = await queryAs<StockResult>(
      ids.admin,
      `select movement_id::text, new_balance::text, applied
       from public.adjust_stock(
         '${ids.adjustProduct}', 3, '${ids.stockA}', 'Contagem física', 'adjust:positive:1'
      );`,
    );
    const positiveResult = onlyResult(positive);
    const negative = await queryAs<StockResult>(
      ids.admin,
      `select movement_id::text, new_balance::text, applied
       from public.adjust_stock(
         '${ids.adjustProduct}', -4, '${ids.stockA}', 'Correção compensatória',
         'adjust:negative:1', '${positiveResult.movement_id}'
       );`,
    );
    const negativeResult = onlyResult(negative);

    expect(positiveResult.new_balance).toBe('13.000');
    expect(negativeResult.new_balance).toBe('9.000');
    expect(
      await scalar(
        `select reference_id::text as value from public.stock_movements where id = '${negativeResult.movement_id}';`,
      ),
    ).toBe(positiveResult.movement_id);
  });

  it('aplica saldo inicial legado como movimento único vinculado ao import_batch', async () => {
    const rows = await queryAs<StockResult>(
      ids.admin,
      `select movement_id::text, new_balance::text, applied
       from public.apply_migration_opening_balance(
         '${ids.openingProduct}', 45, '${ids.stockA}', '${ids.importBatch}', 'migration:opening:1'
       );`,
    );
    const result = onlyResult(rows);
    expect(result).toMatchObject({ new_balance: '45.000', applied: true });
    expect(
      await scalar(
        `select reason as value from public.stock_movements where id = '${result.movement_id}';`,
      ),
    ).toBe('Migração sistema legado');
    expect(
      await scalar(
        `select import_batch_id::text as value from public.stock_movements where id = '${result.movement_id}';`,
      ),
    ).toBe(ids.importBatch);

    await expect(
      queryAs(
        ids.admin,
        `select * from public.apply_migration_opening_balance(
          '${ids.openingProduct}', 1, '${ids.stockA}', '${ids.importBatch}', 'migration:opening:2'
        );`,
      ),
    ).rejects.toThrow(/already has stock history/i);
  });

  it('registra transferência sem alterar o saldo central agregado', async () => {
    const rows = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.transfer_stock(
         '${ids.transferProduct}', 4, '${ids.stockA}', '${ids.stockB}', 'transfer:1'
       );`,
    );
    const result = onlyResult(rows);
    expect(result).toMatchObject({ new_balance: '10.000', applied: true });
    const snapshot = await database.query<{ balance_before: string; balance_after: string }>(`
      select balance_before::text, balance_after::text
      from public.stock_movements where id = '${result.movement_id}';
    `);
    expect(snapshot.rows).toEqual([{ balance_before: '10.000', balance_after: '10.000' }]);
  });

  it('serializa duas saídas concorrentes e confirma somente uma quando o saldo é 10', async () => {
    await assumeIdentity('authenticated', ids.operator);
    let settled: PromiseSettledResult<unknown>[];
    try {
      settled = await Promise.allSettled([
        database.query(`select * from public.consume_stock(
          '${ids.concurrencyProduct}', 7, '${ids.stockA}', 'concurrency:a'
        );`),
        database.query(`select * from public.consume_stock(
          '${ids.concurrencyProduct}', 7, '${ids.stockA}', 'concurrency:b'
        );`),
      ]);
    } finally {
      await resetIdentity();
    }

    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.concurrencyProduct}';`,
      ),
    ).toBe('3.000');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.concurrencyProduct}';`,
      ),
    ).toBe('1');
  });

  it('reutiliza idempotency_key sem duplicar efeito e rejeita payload diferente', async () => {
    const first = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.receive_stock(
         '${ids.idempotencyProduct}', 5, '${ids.stockA}', 'idempotency:1'
       );`,
    );
    const repeated = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.receive_stock(
         '${ids.idempotencyProduct}', 5, '${ids.stockA}', 'idempotency:1'
       );`,
    );

    expect(repeated[0]).toEqual({ ...first[0], applied: false });
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.idempotencyProduct}';`,
      ),
    ).toBe('1');
    await database.exec(
      `update public.locations set is_active = false where id = '${ids.stockA}';`,
    );
    const repeatedAfterLocationDeactivation = await queryAs<StockResult>(
      ids.operator,
      `select movement_id::text, new_balance::text, applied
       from public.receive_stock(
         '${ids.idempotencyProduct}', 5, '${ids.stockA}', 'idempotency:1'
       );`,
    );
    expect(repeatedAfterLocationDeactivation[0]).toEqual({ ...first[0], applied: false });
    await database.exec(`update public.locations set is_active = true where id = '${ids.stockA}';`);

    await expect(
      queryAs(
        ids.admin,
        `select * from public.receive_stock(
          '${ids.idempotencyProduct}', 5, '${ids.stockA}', 'idempotency:1'
        );`,
      ),
    ).rejects.toThrow(/different payload/i);
    await expect(
      queryAs(
        ids.operator,
        `select * from public.receive_stock(
          '${ids.idempotencyProduct}', 6, '${ids.stockA}', 'idempotency:1'
        );`,
      ),
    ).rejects.toThrow(/different payload/i);
    await expect(
      queryAs(
        ids.operator,
        `select * from public.receive_stock(
          '${ids.legacyKeyProduct}', 1, '${ids.stockA}', 'legacy:key:1'
        );`,
      ),
    ).rejects.toThrow(/different payload/i);
  });

  it('faz rollback do movimento quando a atualização de saldo falha', async () => {
    await expect(
      queryAs(
        ids.operator,
        `select * from public.receive_stock(
          '${ids.rollbackProduct}', 2, '${ids.stockA}', 'rollback:1'
        );`,
      ),
    ).rejects.toThrow(/forced balance update failure/i);

    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.rollbackProduct}';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_balances where product_id = '${ids.rollbackProduct}';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select count(*)::text as value from public.audit_logs where new_data ->> 'product_id' = '${ids.rollbackProduct}';`,
      ),
    ).toBe('0');
  });

  it('rejeita saldo negativo sem registrar movimento', async () => {
    await expect(
      queryAs(
        ids.operator,
        `select * from public.consume_stock(
          '${ids.negativeProduct}', 4, '${ids.stockA}', 'negative:1'
        );`,
      ),
    ).rejects.toThrow(/negative balance is forbidden/i);
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.negativeProduct}';`,
      ),
    ).toBe('3.000');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.negativeProduct}';`,
      ),
    ).toBe('0');
  });

  it('nega operações ao VIEWER e ajuste ao STOCK_OPERATOR', async () => {
    await assumeIdentity('anon');
    try {
      await expect(
        database.query(`select * from public.receive_stock(
          '${ids.unauthorizedProduct}', 1, '${ids.stockA}', 'unauthorized:anonymous'
        );`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetIdentity();
    }
    await expect(
      queryAs(
        ids.viewer,
        `select * from public.receive_stock(
          '${ids.unauthorizedProduct}', 1, '${ids.stockA}', 'unauthorized:viewer'
        );`,
      ),
    ).rejects.toThrow(/stock operation role is required/i);
    await expect(
      queryAs(
        ids.noRole,
        `select * from public.receive_stock(
          '${ids.unauthorizedProduct}', 1, '${ids.stockA}', 'unauthorized:no-role'
        );`,
      ),
    ).rejects.toThrow(/stock operation role is required/i);
    await expect(
      queryAs(
        ids.operator,
        `select * from public.adjust_stock(
          '${ids.unauthorizedProduct}', 1, '${ids.stockA}', 'Sem permissão',
          'unauthorized:operator-adjust'
        );`,
      ),
    ).rejects.toThrow(/ADMIN role is required/i);
  });
});
