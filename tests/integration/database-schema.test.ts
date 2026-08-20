import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  category: '22222222-2222-4222-8222-222222222222',
  product: '33333333-3333-4333-8333-333333333333',
  supplier: '44444444-4444-4444-8444-444444444444',
  location: '55555555-5555-4555-8555-555555555555',
  invoice: '66666666-6666-4666-8666-666666666666',
  importBatch: '77777777-7777-4777-8777-777777777777',
  movement: '88888888-8888-4888-8888-888888888888',
} as const;

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

beforeAll(async () => {
  database = new PGlite();

  // PGlite supplies PostgreSQL itself. This prelude reproduces only the Supabase-owned
  // identities referenced by application migrations.
  await database.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create table auth.users (id uuid primary key);
  `);

  await runMigrations(database);

  await database.exec(`
    insert into auth.users (id) values ('${ids.user}');
    insert into public.profiles (id, display_name) values ('${ids.user}', 'Usuário de teste');

    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'Ingredientes', '${ids.user}', '${ids.user}');

    insert into public.locations (
      id, name, location_type, created_by, updated_by
    ) values (
      '${ids.location}', 'Estoque central', 'STOCK', '${ids.user}', '${ids.user}'
    );

    insert into public.suppliers (id, legal_name, document)
    values ('${ids.supplier}', 'Fornecedor Teste Ltda.', '00.000.000/0001-00');

    insert into public.products (
      id, name, sku, ean, product_type, unit, category_id, created_by, updated_by
    ) values (
      '${ids.product}', 'Item de teste', 'ITEM-001', '7890000000000', 'RAW', 'KG',
      '${ids.category}', '${ids.user}', '${ids.user}'
    );

    insert into public.stock_balances (product_id, quantity)
    values ('${ids.product}', 10.000);

    insert into public.invoices (
      id, supplier_id, access_key, invoice_number, issued_at, created_by
    ) values (
      '${ids.invoice}', '${ids.supplier}', 'ACCESS-KEY-001', '1001', statement_timestamp(),
      '${ids.user}'
    );

    insert into public.import_batches (
      id, source_type, source_name, file_hash, total_rows, created_by
    ) values (
      '${ids.importBatch}', 'CSV', 'Sistema legado', 'sha256:test', 2, '${ids.user}'
    );

    insert into public.stock_movements (
      id, product_id, movement_type, quantity, destination_location_id, invoice_id,
      idempotency_key, created_by
    ) values (
      '${ids.movement}', '${ids.product}', 'PURCHASE_ENTRY', 10.000, '${ids.location}',
      '${ids.invoice}', 'movement:test:001', '${ids.user}'
    );
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('migrations do esquema principal', () => {
  it('cria todas as entidades solicitadas', async () => {
    const result = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name;
    `);

    expect(result.rows.map(({ table_name }) => table_name)).toEqual([
      'audit_logs',
      'categories',
      'external_entity_mappings',
      'import_batches',
      'import_rows',
      'invoice_items',
      'invoices',
      'locations',
      'products',
      'profiles',
      'roles',
      'stock_balances',
      'stock_movements',
      'supplier_product_mappings',
      'suppliers',
      'user_roles',
    ]);
  });

  it('mantém todas as quantidades como NUMERIC e nunca FLOAT', async () => {
    const result = await database.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(`
      select table_name, column_name, data_type, numeric_precision, numeric_scale
      from information_schema.columns
      where table_schema = 'public'
        and column_name in ('quantity', 'minimum_quantity')
      order by table_name, column_name;
    `);

    expect(result.rows).toHaveLength(4);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: 'invoice_items',
          column_name: 'quantity',
          data_type: 'numeric',
          numeric_precision: 18,
          numeric_scale: 3,
        }),
        expect.objectContaining({
          table_name: 'products',
          column_name: 'minimum_quantity',
          data_type: 'numeric',
          numeric_precision: 18,
          numeric_scale: 3,
        }),
        expect.objectContaining({
          table_name: 'stock_balances',
          column_name: 'quantity',
          data_type: 'numeric',
          numeric_precision: 18,
          numeric_scale: 3,
        }),
        expect.objectContaining({
          table_name: 'stock_movements',
          column_name: 'quantity',
          data_type: 'numeric',
          numeric_precision: 18,
          numeric_scale: 3,
        }),
      ]),
    );
  });

  it('define os valores obrigatórios dos enums de domínio', async () => {
    const result = await database.query<{ type_name: string; values: string[] }>(`
      select enum_type.typname as type_name,
             array_agg(enum_value.enumlabel order by enum_value.enumsortorder) as values
      from pg_type enum_type
      join pg_enum enum_value on enum_value.enumtypid = enum_type.oid
      join pg_namespace namespace on namespace.oid = enum_type.typnamespace
      where namespace.nspname = 'public'
        and enum_type.typname in (
          'product_type', 'unit_type', 'location_type', 'movement_type',
          'invoice_status', 'import_status', 'import_row_validation_state'
        )
      group by enum_type.typname;
    `);

    const enums = Object.fromEntries(
      result.rows.map(({ type_name, values }) => [type_name, values]),
    );

    expect(enums).toMatchObject({
      product_type: ['RAW', 'FRACTIONATED'],
      unit_type: ['UN', 'KG'],
      location_type: ['STOCK', 'CONSUMPTION'],
      invoice_status: ['DRAFT', 'PENDING_REVIEW', 'CONFIRMED', 'CANCELLED'],
      import_status: [
        'UPLOADED',
        'ANALYZING',
        'PENDING_MAPPING',
        'VALIDATING',
        'READY',
        'IMPORTING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ],
      import_row_validation_state: ['VALID', 'WARNING', 'ERROR', 'CONFLICT', 'IGNORED'],
    });
    expect(enums.movement_type).toEqual([
      'PURCHASE_ENTRY',
      'CONSUMPTION_EXIT',
      'LOSS',
      'ADJUSTMENT_POSITIVE',
      'ADJUSTMENT_NEGATIVE',
      'TRANSFER',
      'FRACTIONATION',
      'MIGRATION_OPENING_BALANCE',
    ]);
  });

  it('persiste regras e resultados de validação exclusivamente no staging', async () => {
    const result = await database.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
    }>(`
      select table_name, column_name, data_type, udt_name
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'import_batches' and column_name in (
            'value_mapping', 'value_mapping_version', 'approved_category_creations'
          ))
          or
          (table_name = 'import_rows' and column_name in (
            'validation_state', 'validation_suggestions', 'category_candidate'
          ))
        )
      order by table_name, column_name;
    `);

    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table_name: 'import_batches', column_name: 'value_mapping' }),
        expect.objectContaining({
          table_name: 'import_batches',
          column_name: 'approved_category_creations',
        }),
        expect.objectContaining({
          table_name: 'import_rows',
          column_name: 'validation_state',
          udt_name: 'import_row_validation_state',
        }),
        expect.objectContaining({
          table_name: 'import_rows',
          column_name: 'validation_suggestions',
        }),
        expect.objectContaining({ table_name: 'import_rows', column_name: 'category_candidate' }),
      ]),
    );
  });

  it('habilita RLS e mantém os papéis da Data API sem privilégios de tabela', async () => {
    const rlsResult = await database.query<{ relname: string }>(`
      select class.relname
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public'
        and class.relkind = 'r'
        and class.relrowsecurity
      order by class.relname;
    `);

    expect(rlsResult.rows).toHaveLength(16);

    const privilegeResult = await database.query<{ role_name: string; table_name: string }>(`
      select role_name, table_name
      from (values ('anon'), ('authenticated')) as roles(role_name)
      cross join information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and (
          has_table_privilege(role_name, format('%I.%I', table_schema, table_name), 'select')
          or has_table_privilege(role_name, format('%I.%I', table_schema, table_name), 'insert')
          or has_table_privilege(role_name, format('%I.%I', table_schema, table_name), 'update')
          or has_table_privilege(role_name, format('%I.%I', table_schema, table_name), 'delete')
        );
    `);

    expect(privilegeResult.rows).toEqual([]);
  });
});

describe('integridade e histórico', () => {
  it('trata SKU sem diferenciar maiúsculas ou espaços externos', async () => {
    await expect(
      database.exec(`
        insert into public.products (
          name, sku, product_type, unit, category_id, created_by, updated_by
        ) values (
          'Duplicado', ' item-001 ', 'RAW', 'KG', '${ids.category}', '${ids.user}', '${ids.user}'
        );
      `),
    ).rejects.toThrow(/products_sku_unique/i);
  });

  it('garante unicidade de access_key quando informada', async () => {
    await expect(
      database.exec(`
        insert into public.invoices (
          supplier_id, access_key, invoice_number, issued_at, created_by
        ) values (
          '${ids.supplier}', 'ACCESS-KEY-001', '1002', statement_timestamp(), '${ids.user}'
        );
      `),
    ).rejects.toThrow(/invoices_access_key_unique/i);
  });

  it('rejeita estoque negativo no próprio banco', async () => {
    await expect(
      database.exec(`
        update public.stock_balances set quantity = -0.001 where product_id = '${ids.product}';
      `),
    ).rejects.toThrow(/stock_balances_quantity_nonnegative/i);
  });

  it('impede duplicação de movimentação pela chave de idempotência', async () => {
    await expect(
      database.exec(`
        insert into public.stock_movements (
          product_id, movement_type, quantity, destination_location_id,
          idempotency_key, created_by
        ) values (
          '${ids.product}', 'ADJUSTMENT_POSITIVE', 1.000, '${ids.location}',
          'movement:test:001', '${ids.user}'
        );
      `),
    ).rejects.toThrow(/stock_movements_idempotency_key_unique/i);
  });

  it('torna stock_movements append-only', async () => {
    await expect(
      database.exec(`
        update public.stock_movements set reason = 'edição proibida' where id = '${ids.movement}';
      `),
    ).rejects.toThrow(/append-only/i);

    await expect(
      database.exec(`delete from public.stock_movements where id = '${ids.movement}';`),
    ).rejects.toThrow(/append-only/i);
  });

  it('isola staging por lote e número da linha', async () => {
    await database.exec(`
      insert into public.import_rows (import_batch_id, row_number, raw_data)
      values ('${ids.importBatch}', 1, '{"sku":"LEGACY-001"}'::jsonb);
    `);

    await expect(
      database.exec(`
        insert into public.import_rows (import_batch_id, row_number, raw_data)
        values ('${ids.importBatch}', 1, '{"sku":"OUTRO"}'::jsonb);
      `),
    ).rejects.toThrow(/import_rows_batch_row_unique/i);
  });

  it('bloqueia repetição acidental do mesmo hash de arquivo', async () => {
    await expect(
      database.exec(`
        insert into public.import_batches (
          source_type, source_name, file_hash, total_rows, created_by
        ) values (
          'CSV', 'Outra origem', 'sha256:test', 0, '${ids.user}'
        );
      `),
    ).rejects.toThrow(/import_batches_original_file_hash_unique/i);

    await database.exec(`
      insert into public.import_batches (
        source_type, source_name, file_hash, total_rows, created_by, duplicate_of_batch_id
      ) values (
        'CSV', 'Reprocessamento autorizado', 'sha256:test', 0, '${ids.user}', '${ids.importBatch}'
      );
    `);
  });

  it('restringe exclusão de entidades referenciadas pelo histórico', async () => {
    await expect(
      database.exec(`delete from public.products where id = '${ids.product}';`),
    ).rejects.toThrow(/foreign key constraint/i);
  });
});
