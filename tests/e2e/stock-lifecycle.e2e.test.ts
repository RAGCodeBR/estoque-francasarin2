import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: '81000000-0000-4000-8000-000000000001',
  operator: '81000000-0000-4000-8000-000000000002',
  viewer: '81000000-0000-4000-8000-000000000003',
  category: '82000000-0000-4000-8000-000000000001',
  stock: '83000000-0000-4000-8000-000000000001',
  consumption: '83000000-0000-4000-8000-000000000002',
  lifecycle: '84000000-0000-4000-8000-000000000001',
  insufficient: '84000000-0000-4000-8000-000000000002',
  concurrency: '84000000-0000-4000-8000-000000000003',
  idempotency: '84000000-0000-4000-8000-000000000004',
  unauthorized: '84000000-0000-4000-8000-000000000005',
  rollback: '84000000-0000-4000-8000-000000000006',
} as const;

interface StockResult {
  movement_id: string;
  new_balance: string;
  applied: boolean;
}

interface JsonReportRow {
  report: Record<string, unknown>;
}

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  for (const fileName of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, fileName), 'utf8'));
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

async function queryAs<T>(
  role: 'anon' | 'authenticated',
  userId: string | undefined,
  sql: string,
): Promise<readonly T[]> {
  await assumeIdentity(role, userId);
  try {
    return (await database.query<T>(sql)).rows;
  } finally {
    await resetIdentity();
  }
}

async function scalar(sql: string): Promise<string> {
  return (await database.query<{ value: string }>(sql)).rows[0]?.value ?? '';
}

function only<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) throw new Error('Expected exactly one result');
  return row;
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
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    create table auth.users (id uuid primary key, email text);
  `);
  await runMigrations(database);
  await database.exec(`
    insert into auth.users (id, email) values
      ('${ids.admin}', 'e2e-admin@example.com'),
      ('${ids.operator}', 'e2e-operator@example.com'),
      ('${ids.viewer}', 'e2e-viewer@example.com');

    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'E2E', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.stock}', 'Estoque E2E', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.consumption}', 'Cozinha E2E', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');

    insert into public.products (
      id, name, sku, product_type, unit, category_id, created_by, updated_by
    ) values
      ('${ids.insufficient}', 'Saldo insuficiente', 'E2E-INSUFFICIENT', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.concurrency}', 'Concorrência', 'E2E-CONCURRENCY', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.idempotency}', 'Idempotência', 'E2E-IDEMPOTENCY', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.unauthorized}', 'Sem autorização', 'E2E-UNAUTHORIZED', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.rollback}', 'Rollback', 'E2E-ROLLBACK', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}');

    insert into public.stock_balances (product_id, quantity) values
      ('${ids.insufficient}', 5),
      ('${ids.concurrency}', 10),
      ('${ids.rollback}', 0);

    create function private.fail_e2e_rollback_balance()
    returns trigger language plpgsql set search_path = pg_catalog as $$
    begin
      if new.product_id = '${ids.rollback}'::uuid then
        raise exception 'forced e2e balance failure';
      end if;
      return new;
    end;
    $$;
    create trigger stock_balances_force_e2e_rollback
    before update on public.stock_balances
    for each row execute function private.fail_e2e_rollback_balance();
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('Bloco 24 — jornada E2E do estoque', () => {
  it('cria produto e percorre 0 → 100 → 75 → 70 → 72 somente por movimentos', async () => {
    await queryAs(
      'authenticated',
      ids.admin,
      `insert into public.products (
        id, name, sku, product_type, unit, category_id, minimum_quantity,
        created_by, updated_by
      ) values (
        '${ids.lifecycle}', 'Arroz E2E', 'E2E-LIFECYCLE', 'RAW', 'KG',
        '${ids.category}', 10, '${ids.admin}', '${ids.admin}'
      );`,
    );
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_balances where product_id = '${ids.lifecycle}';`,
      ),
    ).toBe('0');

    const received = only(
      await queryAs<StockResult>(
        'authenticated',
        ids.operator,
        `select movement_id::text, new_balance::text, applied
         from public.receive_stock(
           '${ids.lifecycle}', 100, '${ids.stock}', 'e2e:lifecycle:receive'
         );`,
      ),
    );
    expect(received).toMatchObject({ new_balance: '100.000', applied: true });

    const consumed = only(
      await queryAs<StockResult>(
        'authenticated',
        ids.operator,
        `select movement_id::text, new_balance::text, applied
         from public.consume_stock(
           '${ids.lifecycle}', 25, '${ids.stock}', 'e2e:lifecycle:consume', '${ids.consumption}'
         );`,
      ),
    );
    expect(consumed).toMatchObject({ new_balance: '75.000', applied: true });

    const lost = only(
      await queryAs<JsonReportRow>(
        'authenticated',
        ids.operator,
        `select public.register_stock_loss(
          '${ids.lifecycle}', 5, '${ids.stock}', 'Quebra operacional', 'Cenário E2E',
          'e2e:lifecycle:loss'
        ) as report;`,
      ),
    ).report;
    expect(lost).toMatchObject({ newBalance: '70.000', applied: true });

    const created = only(
      await queryAs<JsonReportRow>(
        'authenticated',
        ids.operator,
        `select public.create_inventory_count(
          '${ids.stock}', 'Contagem física E2E', null
        ) as report;`,
      ),
    ).report;
    const inventoryCountId = String(created.inventoryCountId);
    await queryAs(
      'authenticated',
      ids.operator,
      `select public.open_inventory_count('${inventoryCountId}');`,
    );
    await queryAs(
      'authenticated',
      ids.operator,
      `select public.save_inventory_count_items(
        '${inventoryCountId}',
        '[{"product_id":"${ids.lifecycle}","counted_quantity":"72.000"}]'::jsonb,
        true
      );`,
    );
    await queryAs(
      'authenticated',
      ids.operator,
      `select public.review_inventory_count('${inventoryCountId}');`,
    );
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.lifecycle}';`,
      ),
    ).toBe('70.000');

    const confirmed = only(
      await queryAs<JsonReportRow>(
        'authenticated',
        ids.admin,
        `select public.confirm_inventory_count(
          '${inventoryCountId}', 'e2e:lifecycle:inventory'
        ) as report;`,
      ),
    ).report;
    expect(confirmed).toMatchObject({ movementsCreated: 1, applied: true });
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.lifecycle}';`,
      ),
    ).toBe('72.000');

    const movements = await database.query<{
      movement_type: string;
      quantity: string;
      balance_after: string;
    }>(`
      select movement_type::text, quantity::text, balance_after::text
      from public.stock_movements
      where product_id = '${ids.lifecycle}'
      order by created_at, id;
    `);
    expect(movements.rows).toEqual([
      { movement_type: 'PURCHASE_ENTRY', quantity: '100.000', balance_after: '100.000' },
      { movement_type: 'CONSUMPTION_EXIT', quantity: '25.000', balance_after: '75.000' },
      { movement_type: 'LOSS', quantity: '5.000', balance_after: '70.000' },
      { movement_type: 'ADJUSTMENT_POSITIVE', quantity: '2.000', balance_after: '72.000' },
    ]);
  }, 60_000);

  it('bloqueia retirada acima do saldo sem efeitos parciais', async () => {
    await expect(
      queryAs(
        'authenticated',
        ids.operator,
        `select * from public.consume_stock(
          '${ids.insufficient}', 10, '${ids.stock}', 'e2e:insufficient', '${ids.consumption}'
        );`,
      ),
    ).rejects.toThrow(/negative balance is forbidden/i);
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.insufficient}';`,
      ),
    ).toBe('5.000');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.insufficient}';`,
      ),
    ).toBe('0');
  });

  it('serializa concorrência e mantém exatamente um consumo possível', async () => {
    await assumeIdentity('authenticated', ids.operator);
    let settled: PromiseSettledResult<unknown>[];
    try {
      settled = await Promise.allSettled([
        database.query(`select * from public.consume_stock(
          '${ids.concurrency}', 7, '${ids.stock}', 'e2e:concurrency:a', '${ids.consumption}'
        );`),
        database.query(`select * from public.consume_stock(
          '${ids.concurrency}', 7, '${ids.stock}', 'e2e:concurrency:b', '${ids.consumption}'
        );`),
      ]);
    } finally {
      await resetIdentity();
    }
    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.concurrency}';`,
      ),
    ).toBe('3.000');
  });

  it('replay idempotente não duplica saldo nem movimento', async () => {
    const sql = `select movement_id::text, new_balance::text, applied
      from public.receive_stock(
        '${ids.idempotency}', 5, '${ids.stock}', 'e2e:idempotency'
      );`;
    const first = only(await queryAs<StockResult>('authenticated', ids.operator, sql));
    const replay = only(await queryAs<StockResult>('authenticated', ids.operator, sql));
    expect(first).toMatchObject({ new_balance: '5.000', applied: true });
    expect(replay).toEqual({ ...first, applied: false });
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.idempotency}';`,
      ),
    ).toBe('1');
  });

  it('nega mutações de estoque ao VIEWER e ao anônimo', async () => {
    const sql = `select * from public.receive_stock(
      '${ids.unauthorized}', 1, '${ids.stock}', 'e2e:unauthorized'
    );`;
    await expect(queryAs('authenticated', ids.viewer, sql)).rejects.toThrow(
      /stock operation role is required/i,
    );
    await expect(queryAs('anon', undefined, sql)).rejects.toThrow();
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.unauthorized}';`,
      ),
    ).toBe('0');
  });

  it('reverte movimento, saldo e auditoria quando a transação falha', async () => {
    await expect(
      queryAs(
        'authenticated',
        ids.operator,
        `select * from public.receive_stock(
          '${ids.rollback}', 2, '${ids.stock}', 'e2e:rollback'
        );`,
      ),
    ).rejects.toThrow(/forced e2e balance failure/i);
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.rollback}';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.rollback}';`,
      ),
    ).toBe('0.000');
    expect(
      await scalar(
        `select count(*)::text as value from public.audit_logs where new_data ->> 'product_id' = '${ids.rollback}';`,
      ),
    ).toBe('0');
  });
});
