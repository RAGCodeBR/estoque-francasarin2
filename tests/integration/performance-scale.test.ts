import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const ids = {
  admin: 'e1000000-0000-4000-8000-000000000001',
  category: 'e1000000-0000-4000-8000-000000000002',
  stock: 'e1000000-0000-4000-8000-000000000003',
  supplier: 'e1000000-0000-4000-8000-000000000004',
  batch: 'e1000000-0000-4000-8000-000000000005',
} as const;

let database: PGlite;

async function runMigrations(db: PGlite): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
}

async function explain(sql: string): Promise<string> {
  const result = await database.query<Readonly<Record<string, unknown>>>(
    `explain (format json) ${sql}`,
  );
  return JSON.stringify(result.rows);
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
    insert into auth.users (id, email) values ('${ids.admin}', 'scale-admin@example.com');
    update public.profiles set display_name = 'Admin Escala' where id = '${ids.admin}';
    insert into public.user_roles (profile_id, role_id, granted_by)
      select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.categories (id, name, created_by, updated_by)
      values ('${ids.category}', 'Escala', '${ids.admin}', '${ids.admin}');
    insert into public.locations (id, name, location_type, created_by, updated_by)
      values ('${ids.stock}', 'Estoque escala', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.suppliers (id, legal_name, document)
      values ('${ids.supplier}', 'Fornecedor Escala', '99999999000199');

    alter table public.products disable trigger user;
    insert into public.products (
      name, sku, product_type, unit, category_id, minimum_quantity, created_by, updated_by
    )
    select
      'Produto escala ' || lpad(series::text, 4, '0'),
      'PERF-' || lpad(series::text, 4, '0'),
      'RAW', case when series % 2 = 0 then 'KG'::public.unit_type else 'UN'::public.unit_type end,
      '${ids.category}', 5, '${ids.admin}', '${ids.admin}'
    from generate_series(1, 1000) series;
    alter table public.products enable trigger user;

    insert into public.stock_balances (product_id, quantity)
    select id, 100 from public.products where sku like 'PERF-%';

    alter table public.stock_movements disable trigger user;
    insert into public.stock_movements (
      product_id, movement_type, quantity, unit, source_location_id,
      reason, idempotency_key, created_at, created_by
    )
    select
      product.id,
      case when series % 5 = 0 then 'LOSS'::public.movement_type
        else 'CONSUMPTION_EXIT'::public.movement_type end,
      1,
      product.unit,
      '${ids.stock}',
      'Carga de escala',
      'scale:movement:' || series::text,
      statement_timestamp() - ((series % 180)::text || ' days')::interval,
      '${ids.admin}'
    from generate_series(1, 20000) series
    join lateral (
      select id, unit from public.products
      where sku = 'PERF-' || lpad((((series - 1) % 1000) + 1)::text, 4, '0')
    ) product on true;
    alter table public.stock_movements enable trigger user;

    insert into public.import_batches (
      id, source_type, source_name, original_filename, file_hash, status,
      total_rows, valid_rows, created_by, operational_import_type
    ) values (
      '${ids.batch}', 'CSV', 'Carga escala', 'escala.csv', 'sha256:scale-10000',
      'READY', 10000, 10000, '${ids.admin}', 'PRODUCTS'
    );
    insert into public.import_rows (
      import_batch_id, row_number, raw_data, normalized_data,
      validation_status, validation_state, dry_run_action
    )
    select
      '${ids.batch}', series, jsonb_build_object('CODIGO', 'IMP-' || series::text),
      jsonb_build_object(
        'sku', 'IMP-' || lpad(series::text, 5, '0'),
        'name', 'Importado ' || series::text,
        'category', 'Escala',
        'unit', 'KG',
        'product_type', 'RAW'
      ),
      'VALID', 'VALID', 'NEW'
    from generate_series(1, 10000) series;

    alter table public.invoices disable trigger user;
    insert into public.invoices (
      supplier_id, invoice_number, issued_at, status, created_by
    )
    select '${ids.supplier}', 'NF-' || series::text,
      statement_timestamp() - ((series % 365)::text || ' days')::interval,
      case when series % 4 = 0 then 'CANCELLED'::public.invoice_status
        else 'CONFIRMED'::public.invoice_status end,
      '${ids.admin}'
    from generate_series(1, 2000) series;
    alter table public.invoices enable trigger user;

    insert into public.external_entity_mappings (
      source_system, entity_type, external_id, internal_id
    )
    select 'SCALE', 'PRODUCT', 'EXT-' || row_number() over (), id
    from public.products where sku like 'PERF-%';

    analyze public.products;
    analyze public.stock_movements;
    analyze public.import_rows;
    analyze public.invoices;
    analyze public.audit_logs;
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('performance e escalabilidade do banco', () => {
  it('mantém a paginação de 1.000 produtos no banco e limita o payload', async () => {
    await database.query(`select set_config('request.jwt.claim.sub', $1, false);`, [ids.admin]);
    await database.exec('set role authenticated;');
    const result = await database.query<{ payload: unknown }>(
      `select public.search_products(null, null, null, null, true, 40, 25) as payload;`,
    );
    await database.exec('reset role;');
    const serialized = JSON.stringify(result.rows[0]?.payload);
    expect(serialized).toContain('PERF-');
    expect(serialized.length).toBeLessThan(100_000);
    expect(result.rows[0]?.payload).toMatchObject({ page: 40, page_size: 25, total: 1000 });
  });

  it('usa índice temporal para movimentos sem exigir tipo ou produto', async () => {
    const plan = await explain(`
      select id, product_id, created_at
      from public.stock_movements
      where created_at >= statement_timestamp() - interval '7 days'
      order by created_at desc, id desc
      limit 25
    `);
    expect(plan).toContain('stock_movements_created_at_browse_idx');
  });

  it('usa índices por lote para staging e por status/período para notas', async () => {
    const importPlan = await explain(`
      select id from public.import_rows
      where import_batch_id = '${ids.batch}'
        and validation_state <> 'IGNORED'
        and nullif(normalized_data ->> 'sku', '') is not null
        and lower(normalized_data ->> 'sku') = 'imp-09999'
    `);
    const invoicePlan = await explain(`
      select id, issued_at from public.invoices
      where status = 'CONFIRMED'
      order by issued_at desc, id desc
      limit 25
    `);
    expect(importPlan).toContain('import_rows_batch_normalized_sku_idx');
    expect(invoicePlan).toContain('invoices_status_issued_at_idx');
  });

  it('executa o staging validado de 1.000 produtos dentro de uma única transação', async () => {
    await database.query(`select set_config('request.jwt.claim.sub', $1, false);`, [ids.admin]);
    await database.exec('set role authenticated;');
    const startedAt = performance.now();
    const result = await database.query<{
      batch_id: string;
      status: string;
      summary: Readonly<Record<string, number>>;
    }>(`
        with staged_rows as (
          select jsonb_agg(jsonb_build_object(
            'rowNumber', series,
            'rawData', jsonb_build_object('CODIGO', 'RPC-' || series::text),
            'normalizedData', jsonb_build_object(
              'sku', 'RPC-' || lpad(series::text, 5, '0'),
              'name', 'Produto RPC ' || series::text,
              'category', 'Escala',
              'unit', 'KG',
              'product_type', 'RAW',
              'minimum_quantity', '5.000'
            ),
            'validationErrors', '[]'::jsonb,
            'ignored', false
          ) order by series) as rows
          from generate_series(1, 1000) series
        )
        select preview.*
        from staged_rows
        cross join lateral public.stage_product_import_preview(
          'MASTER_DATA_IMPORT',
          'CSV',
          'Carga RPC de escala',
          'rpc-escala-1000.csv',
          'sha256:rpc-scale-1000',
          100000,
          '["CODIGO","PRODUTO","CATEGORIA","TIPO","UNIDADE","MINIMO"]'::jsonb,
          '[
            {"sourceColumn":"CODIGO","targetField":"sku"},
            {"sourceColumn":"PRODUTO","targetField":"name"},
            {"sourceColumn":"CATEGORIA","targetField":"category"},
            {"sourceColumn":"TIPO","targetField":"product_type"},
            {"sourceColumn":"UNIDADE","targetField":"unit"},
            {"sourceColumn":"MINIMO","targetField":"minimum_quantity"}
          ]'::jsonb,
          '{}'::jsonb,
          staged_rows.rows,
          null
        ) preview
      `);
    const elapsedMilliseconds = performance.now() - startedAt;
    await database.exec('reset role;');

    expect(result.rows[0]).toMatchObject({
      status: 'READY',
      summary: { TOTAL: 1000, VALID: 1000, INVALID: 0, CONFLICT: 0 },
    });
    expect(elapsedMilliseconds).toBeLessThan(10_000);
  }, 15_000);

  it('preserva índices de prefixo para todas as foreign keys públicas', async () => {
    const missing = await database.query<{ table_name: string; constraint_name: string }>(`
      select constraint_table.relname as table_name, constraint_data.conname as constraint_name
      from pg_constraint constraint_data
      join pg_class constraint_table on constraint_table.oid = constraint_data.conrelid
      join pg_namespace namespace on namespace.oid = constraint_table.relnamespace
      where constraint_data.contype = 'f'
        and namespace.nspname = 'public'
        and not exists (
          select 1 from pg_index index_data
          where index_data.indrelid = constraint_data.conrelid
            and index_data.indisvalid
            and index_data.indkey[0] = constraint_data.conkey[1]
        )
      order by constraint_table.relname, constraint_data.conname
    `);
    expect(missing.rows).toEqual([]);
  });

  it('não mantém policies permissivas duplicadas para a mesma operação', async () => {
    const duplicates = await database.query<{
      schemaname: string;
      tablename: string;
      command: string;
      roles: string[];
    }>(`
      select schemaname, tablename, cmd as command, roles
      from pg_policies
      where permissive = 'PERMISSIVE'
      group by schemaname, tablename, cmd, roles
      having count(*) > 1
    `);
    expect(duplicates.rows).toEqual([]);
  });

  it('mantém mapeamentos externos inequívocos com lookup indexado nos dois sentidos', async () => {
    const externalPlan = await explain(`
      select internal_id from public.external_entity_mappings
      where source_system = 'SCALE' and entity_type = 'PRODUCT' and external_id = 'EXT-999'
    `);
    const internalPlan = await explain(`
      select external_id from public.external_entity_mappings
      where entity_type = 'PRODUCT'
        and internal_id = (select id from public.products where sku = 'PERF-0999')
    `);
    expect(externalPlan).toContain('external_entity_mappings_natural_key');
    expect(internalPlan).toContain('external_entity_mappings_internal_lookup_idx');
  });
});
