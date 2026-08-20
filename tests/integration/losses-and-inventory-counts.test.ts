import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: '71000000-0000-4000-8000-000000000001',
  operator: '71000000-0000-4000-8000-000000000002',
  viewer: '71000000-0000-4000-8000-000000000003',
  category: '72000000-0000-4000-8000-000000000001',
  stock: '73000000-0000-4000-8000-000000000001',
  consumption: '73000000-0000-4000-8000-000000000002',
  loss: '74000000-0000-4000-8000-000000000001',
  lossInsufficient: '74000000-0000-4000-8000-000000000002',
  positive: '74000000-0000-4000-8000-000000000003',
  negative: '74000000-0000-4000-8000-000000000004',
  unchanged: '74000000-0000-4000-8000-000000000005',
  stale: '74000000-0000-4000-8000-000000000006',
  rollbackA: '74000000-0000-4000-8000-000000000007',
  rollbackB: '74000000-0000-4000-8000-000000000008',
} as const;

interface JsonReportRow {
  report: Record<string, unknown>;
}

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  for (const migrationFile of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), 'utf8'));
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

async function scalar(sql: string): Promise<string> {
  return (await database.query<{ value: string }>(sql)).rows[0]?.value ?? '';
}

function only<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const value = rows[0];
  if (value === undefined) throw new Error('Expected one result');
  return value;
}

async function createCount(
  products: readonly { productId: string; quantity: string }[],
  reference: string,
): Promise<string> {
  const created = only(
    await queryAs<JsonReportRow>(
      ids.operator,
      `select public.create_inventory_count('${ids.stock}', '${reference}', null) as report;`,
    ),
  ).report;
  const countId = String(created.inventoryCountId);
  await queryAs(ids.operator, `select public.open_inventory_count('${countId}');`);
  const items = JSON.stringify(
    products.map(({ productId, quantity }) => ({
      product_id: productId,
      counted_quantity: quantity,
    })),
  ).replaceAll("'", "''");
  await queryAs(
    ids.operator,
    `select public.save_inventory_count_items('${countId}', '${items}'::jsonb, true);`,
  );
  return countId;
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
      ('${ids.admin}', 'inventory-admin@example.com'),
      ('${ids.operator}', 'inventory-operator@example.com'),
      ('${ids.viewer}', 'inventory-viewer@example.com');

    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'Inventário', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.stock}', 'Estoque inventariado', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.consumption}', 'Cozinha inventário', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');

    insert into public.products (
      id, name, sku, product_type, unit, category_id, created_by, updated_by
    ) values
      ('${ids.loss}', 'Produto perda', 'INV-LOSS', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.lossInsufficient}', 'Perda insuficiente', 'INV-LOSS-LOW', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.positive}', 'Ajuste positivo', 'INV-POSITIVE', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.negative}', 'Ajuste negativo', 'INV-NEGATIVE', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.unchanged}', 'Sem diferença', 'INV-SAME', 'RAW', 'UN', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.stale}', 'Snapshot obsoleto', 'INV-STALE', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.rollbackA}', 'Rollback A', 'INV-ROLLBACK-A', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}'),
      ('${ids.rollbackB}', 'Rollback B', 'INV-ROLLBACK-B', 'RAW', 'KG', '${ids.category}', '${ids.admin}', '${ids.admin}');

    insert into public.stock_balances (product_id, quantity) values
      ('${ids.loss}', 10), ('${ids.lossInsufficient}', 1),
      ('${ids.positive}', 47), ('${ids.negative}', 50), ('${ids.unchanged}', 20),
      ('${ids.stale}', 10), ('${ids.rollbackA}', 47), ('${ids.rollbackB}', 50);
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('perdas rastreáveis', () => {
  it('registra produto, quantidade, unidade, local, motivo, observação, usuário e data via LOSS', async () => {
    const sql = `select public.register_stock_loss(
      '${ids.loss}', 2.500, '${ids.stock}', 'Validade expirada', 'Descartado conforme procedimento',
      'loss:tracked:1'
    ) as report;`;
    const first = only(await queryAs<JsonReportRow>(ids.operator, sql)).report;
    const replay = only(await queryAs<JsonReportRow>(ids.operator, sql)).report;

    expect(first).toMatchObject({
      productId: ids.loss,
      quantity: '2.500',
      unit: 'KG',
      locationId: ids.stock,
      reason: 'Validade expirada',
      notes: 'Descartado conforme procedimento',
      createdBy: ids.operator,
      newBalance: '7.500',
      applied: true,
    });
    expect(typeof first.createdAt).toBe('string');
    expect(replay).toMatchObject({
      lossId: first.lossId,
      movementId: first.movementId,
      applied: false,
    });
    expect(
      await scalar(
        `select movement_type::text as value from public.stock_movements where id = '${String(first.movementId)}';`,
      ),
    ).toBe('LOSS');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_losses where idempotency_key = 'loss:tracked:1';`,
      ),
    ).toBe('1');

    await expect(
      queryAs(
        ids.operator,
        `select public.register_stock_loss(
          '${ids.loss}', 2.500, '${ids.stock}', 'Outro motivo', null, 'loss:tracked:1'
        );`,
      ),
    ).rejects.toThrow(/different stock loss payload/i);
  });

  it('reverte perda sem saldo e nega VIEWER', async () => {
    await expect(
      queryAs(
        ids.operator,
        `select public.register_stock_loss(
          '${ids.lossInsufficient}', 2, '${ids.stock}', 'Teste insuficiente', null, 'loss:low:1'
        );`,
      ),
    ).rejects.toThrow(/negative balance is forbidden/i);
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_losses where product_id = '${ids.lossInsufficient}';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.lossInsufficient}';`,
      ),
    ).toBe('1.000');

    await expect(
      queryAs(
        ids.viewer,
        `select public.register_stock_loss(
          '${ids.lossInsufficient}', 1, '${ids.stock}', 'Sem permissão', null, 'loss:viewer:1'
        );`,
      ),
    ).rejects.toThrow(/stock operation role is required/i);
  });
});

describe('inventário físico e reconciliação', () => {
  it('mantém DRAFT, COUNTING e REVIEW sem alterar saldo e confirma por ajustes compensatórios', async () => {
    const countId = await createCount(
      [
        { productId: ids.positive, quantity: '50.000' },
        { productId: ids.negative, quantity: '47.000' },
        { productId: ids.unchanged, quantity: '20.000' },
      ],
      'Inventário mensal',
    );

    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id in ('${ids.positive}', '${ids.negative}', '${ids.unchanged}');`,
      ),
    ).toBe('0');
    const reviewed = only(
      await queryAs<JsonReportRow>(
        ids.operator,
        `select public.review_inventory_count('${countId}') as report;`,
      ),
    ).report;
    expect(reviewed).toMatchObject({
      status: 'REVIEW',
      itemCount: 3,
      positiveAdjustments: 1,
      negativeAdjustments: 1,
      unchangedItems: 1,
      movementsCreated: 0,
    });
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.positive}';`,
      ),
    ).toBe('47.000');
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.negative}';`,
      ),
    ).toBe('50.000');

    await expect(
      queryAs(
        ids.operator,
        `select public.confirm_inventory_count('${countId}', 'inventory:monthly:1');`,
      ),
    ).rejects.toThrow(/ADMIN role is required/i);

    const confirmationSql = `select public.confirm_inventory_count(
      '${countId}', 'inventory:monthly:1'
    ) as report;`;
    const confirmed = only(await queryAs<JsonReportRow>(ids.admin, confirmationSql)).report;
    const replay = only(await queryAs<JsonReportRow>(ids.admin, confirmationSql)).report;
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      movementsCreated: 2,
      applied: true,
      confirmedBy: ids.admin,
    });
    expect(replay).toMatchObject({ inventoryCountId: countId, applied: false });
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.positive}';`,
      ),
    ).toBe('50.000');
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.negative}';`,
      ),
    ).toBe('47.000');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.unchanged}';`,
      ),
    ).toBe('0');
    const types = await database.query<{ movement_type: string; difference_quantity: string }>(`
      select movement.movement_type::text, item.difference_quantity::text
      from public.inventory_count_items item
      join public.stock_movements movement on movement.id = item.movement_id
      where item.inventory_count_id = '${countId}'
      order by item.difference_quantity;
    `);
    expect(types.rows).toEqual([
      { movement_type: 'ADJUSTMENT_NEGATIVE', difference_quantity: '-3.000' },
      { movement_type: 'ADJUSTMENT_POSITIVE', difference_quantity: '3.000' },
    ]);

    await expect(
      queryAs(
        ids.admin,
        `select public.confirm_inventory_count('${countId}', 'inventory:other-key');`,
      ),
    ).rejects.toThrow(/different idempotency payload/i);
  });

  it('recusa confirmação quando o saldo mudou após REVIEW e permite nova contagem', async () => {
    const countId = await createCount(
      [{ productId: ids.stale, quantity: '10.000' }],
      'Inventário concorrente',
    );
    await queryAs(ids.operator, `select public.review_inventory_count('${countId}');`);
    await queryAs(
      ids.operator,
      `select public.receive_stock('${ids.stale}', 1, '${ids.stock}', 'inventory:stale:entry');`,
    );

    await expect(
      queryAs(
        ids.admin,
        `select public.confirm_inventory_count('${countId}', 'inventory:stale:confirm');`,
      ),
    ).rejects.toThrow(/stock balance changed since inventory review/i);
    expect(
      await scalar(
        `select status::text as value from public.inventory_counts where id = '${countId}';`,
      ),
    ).toBe('REVIEW');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id = '${ids.stale}' and movement_type::text like 'ADJUSTMENT%';`,
      ),
    ).toBe('0');

    const reopened = only(
      await queryAs<JsonReportRow>(
        ids.operator,
        `select public.open_inventory_count('${countId}') as report;`,
      ),
    ).report;
    expect(reopened).toMatchObject({ status: 'COUNTING' });
    const items = reopened.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ systemQuantity: null, differenceQuantity: null });
  });

  it('faz rollback integral se um ajuste falhar durante a confirmação', async () => {
    const countId = await createCount(
      [
        { productId: ids.rollbackA, quantity: '50.000' },
        { productId: ids.rollbackB, quantity: '47.000' },
      ],
      'Inventário rollback',
    );
    await queryAs(ids.operator, `select public.review_inventory_count('${countId}');`);
    await database.exec(`
      create function private.fail_inventory_rollback_balance()
      returns trigger language plpgsql set search_path = pg_catalog as $$
      begin
        if new.product_id = '${ids.rollbackB}'::uuid then
          raise exception 'forced inventory adjustment failure';
        end if;
        return new;
      end;
      $$;
      create trigger stock_balances_force_inventory_rollback
      before update on public.stock_balances
      for each row execute function private.fail_inventory_rollback_balance();
    `);

    await expect(
      queryAs(
        ids.admin,
        `select public.confirm_inventory_count('${countId}', 'inventory:rollback:1');`,
      ),
    ).rejects.toThrow(/forced inventory adjustment failure/i);
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.rollbackA}';`,
      ),
    ).toBe('47.000');
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.rollbackB}';`,
      ),
    ).toBe('50.000');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where product_id in ('${ids.rollbackA}', '${ids.rollbackB}');`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select status::text as value from public.inventory_counts where id = '${countId}';`,
      ),
    ).toBe('REVIEW');
  });

  it('nega mutação direta e preserva inventário confirmado como histórico', async () => {
    const confirmedId = await scalar(
      `select id::text as value from public.inventory_counts where status = 'CONFIRMED' limit 1;`,
    );
    await assumeIdentity('authenticated', ids.operator);
    try {
      await expect(
        database.exec(
          `update public.inventory_counts set notes = 'edição direta' where id = '${confirmedId}';`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await resetIdentity();
    }
    await expect(
      database.exec(
        `update public.inventory_counts set notes = 'edição administrativa' where id = '${confirmedId}';`,
      ),
    ).rejects.toThrow(/confirmed inventory counts are immutable/i);
  });
});
