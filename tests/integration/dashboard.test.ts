import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: 'd2100000-0000-4000-8000-000000000001',
  operator: 'd2100000-0000-4000-8000-000000000002',
  viewer: 'd2100000-0000-4000-8000-000000000003',
  noRole: 'd2100000-0000-4000-8000-000000000004',
  food: 'd2200000-0000-4000-8000-000000000001',
  drinks: 'd2200000-0000-4000-8000-000000000002',
  stock: 'd2300000-0000-4000-8000-000000000001',
  kitchen: 'd2300000-0000-4000-8000-000000000002',
  rice: 'd2400000-0000-4000-8000-000000000001',
  meat: 'd2400000-0000-4000-8000-000000000002',
  water: 'd2400000-0000-4000-8000-000000000003',
  inactive: 'd2400000-0000-4000-8000-000000000004',
} as const;

interface DashboardPayload {
  readonly period_days: number;
  readonly indicators: Readonly<Record<string, unknown>>;
  readonly consumption_trend: readonly Readonly<Record<string, unknown>>[];
  readonly top_consumed: readonly Readonly<Record<string, unknown>>[];
  readonly losses_by_category: readonly Readonly<Record<string, unknown>>[];
  readonly consumption_by_location: readonly Readonly<Record<string, unknown>>[];
  readonly recent_movements: readonly Readonly<Record<string, unknown>>[];
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

async function dashboardAs(userId: string, days = 7, recentLimit = 8): Promise<DashboardPayload> {
  await assumeIdentity('authenticated', userId);
  try {
    const value = (
      await database.query<{ dashboard: unknown }>(
        'select public.get_inventory_dashboard($1, $2) as dashboard;',
        [days, recentLimit],
      )
    ).rows[0]?.dashboard;
    return (typeof value === 'string' ? JSON.parse(value) : value) as DashboardPayload;
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
      ('${ids.admin}', 'dashboard-admin@example.com'),
      ('${ids.operator}', 'dashboard-operator@example.com'),
      ('${ids.viewer}', 'dashboard-viewer@example.com'),
      ('${ids.noRole}', 'dashboard-no-role@example.com');
    update public.profiles set display_name = case id
      when '${ids.admin}' then 'Admin Dashboard'
      when '${ids.operator}' then 'Operador Dashboard'
      when '${ids.viewer}' then 'Leitor Dashboard'
      else 'Sem função' end;
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.categories (id, name, created_by, updated_by) values
      ('${ids.food}', 'Alimentos', '${ids.admin}', '${ids.admin}'),
      ('${ids.drinks}', 'Bebidas', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by) values
      ('${ids.stock}', 'Estoque central', 'STOCK', '${ids.admin}', '${ids.admin}'),
      ('${ids.kitchen}', 'Cozinha', 'CONSUMPTION', '${ids.admin}', '${ids.admin}');
    insert into public.products (
      id, name, sku, product_type, unit, category_id, minimum_quantity,
      is_active, created_by, updated_by
    ) values
      ('${ids.rice}', 'Arroz', 'DASH-001', 'RAW', 'KG', '${ids.food}', 5, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.meat}', 'Carne', 'DASH-002', 'RAW', 'KG', '${ids.food}', 3, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.water}', 'Água', 'DASH-003', 'RAW', 'UN', '${ids.drinks}', 10, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.inactive}', 'Inativo', 'DASH-004', 'RAW', 'UN', '${ids.drinks}', 1, false, '${ids.admin}', '${ids.admin}');
    insert into public.stock_balances (product_id, quantity) values
      ('${ids.rice}', 8), ('${ids.meat}', 2);

    insert into public.stock_movements (
      product_id, movement_type, quantity, unit, destination_location_id, reason,
      idempotency_key, created_at, created_by
    ) values
      ('${ids.rice}', 'PURCHASE_ENTRY', 10, 'KG', '${ids.stock}', 'Compra',
       'dashboard:entry:kg', statement_timestamp() - interval '2 days', '${ids.admin}'),
      ('${ids.water}', 'PURCHASE_ENTRY', 12, 'UN', '${ids.stock}', 'Compra',
       'dashboard:entry:un', statement_timestamp() - interval '2 days', '${ids.admin}');
    insert into public.stock_movements (
      product_id, movement_type, quantity, unit, source_location_id, destination_location_id,
      reason, idempotency_key, created_at, created_by
    ) values
      ('${ids.rice}', 'CONSUMPTION_EXIT', 3, 'KG', '${ids.stock}', '${ids.kitchen}',
       'Produção', 'dashboard:consume:rice', statement_timestamp() - interval '1 day', '${ids.operator}'),
      ('${ids.meat}', 'CONSUMPTION_EXIT', 2, 'KG', '${ids.stock}', '${ids.kitchen}',
       'Produção', 'dashboard:consume:meat', statement_timestamp() - interval '1 day', '${ids.operator}'),
      ('${ids.water}', 'CONSUMPTION_EXIT', 4, 'UN', '${ids.stock}', '${ids.kitchen}',
       'Salão', 'dashboard:consume:water', statement_timestamp() - interval '1 day', '${ids.operator}');
    insert into public.stock_movements (
      product_id, movement_type, quantity, unit, source_location_id, reason,
      idempotency_key, created_at, created_by
    ) values
      ('${ids.rice}', 'LOSS', 1, 'KG', '${ids.stock}', 'Dano',
       'dashboard:loss:kg', statement_timestamp() - interval '1 day', '${ids.operator}'),
      ('${ids.water}', 'LOSS', 2, 'UN', '${ids.stock}', 'Dano',
       'dashboard:loss:un', statement_timestamp() - interval '1 day', '${ids.operator}'),
      ('${ids.rice}', 'CONSUMPTION_EXIT', 99, 'KG', '${ids.stock}', 'Histórico antigo',
       'dashboard:old', statement_timestamp() - interval '100 days', '${ids.operator}');
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('dashboard agregado no PostgreSQL', () => {
  it.each([ids.admin, ids.operator, ids.viewer])(
    'autoriza papel operacional %s sem expor dados internos',
    async (userId) => {
      const payload = await dashboardAs(userId, 7, 3);
      expect(payload.period_days).toBe(7);
      expect(payload.recent_movements).toHaveLength(3);
      expect(JSON.stringify(payload)).not.toMatch(/password|token|secret|service_role/i);
    },
  );

  it('calcula indicadores e exclui cadastro inativo', async () => {
    const payload = await dashboardAs(ids.viewer);
    expect(payload.indicators).toMatchObject({
      active_products: 3,
      below_minimum: 1,
      out_of_stock: 1,
      movements: 7,
      entries: { movement_count: 2 },
      consumption: { movement_count: 3 },
      losses: { movement_count: 2 },
    });
  });

  it('agrega tendências e rankings sem somar KG com UN', async () => {
    const payload = await dashboardAs(ids.viewer);
    expect(payload.consumption_trend).toHaveLength(14);
    expect(payload.top_consumed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ product_name: 'Arroz', unit: 'KG', quantity: '3.000' }),
        expect.objectContaining({ product_name: 'Água', unit: 'UN', quantity: '4.000' }),
      ]),
    );
    expect(payload.losses_by_category).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category_name: 'Alimentos', unit: 'KG', quantity: '1.000' }),
        expect.objectContaining({ category_name: 'Bebidas', unit: 'UN', quantity: '2.000' }),
      ]),
    );
    expect(payload.consumption_by_location).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location_name: 'Cozinha', unit: 'KG', quantity: '5.000' }),
        expect.objectContaining({ location_name: 'Cozinha', unit: 'UN', quantity: '4.000' }),
      ]),
    );
  });

  it('rejeita anônimo, usuário sem papel e parâmetros fora da lista segura', async () => {
    await assumeIdentity('anon');
    await expect(database.query('select public.get_inventory_dashboard(7, 8);')).rejects.toThrow();
    await resetIdentity();
    await expect(dashboardAs(ids.noRole)).rejects.toThrow(/not authorized/);
    await expect(dashboardAs(ids.viewer, 14)).rejects.toThrow(/7, 30 or 90/);
    await expect(dashboardAs(ids.viewer, 7, 21)).rejects.toThrow(/between 1 and 20/);
  });
});
