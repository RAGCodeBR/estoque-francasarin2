import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');

const ids = {
  admin: 'f1000000-0000-4000-8000-000000000001',
  operator: 'f1000000-0000-4000-8000-000000000002',
  viewer: 'f1000000-0000-4000-8000-000000000003',
  location: 'f2000000-0000-4000-8000-000000000001',
  category: 'f3000000-0000-4000-8000-000000000001',
  associatedProduct: 'f4000000-0000-4000-8000-000000000001',
  reconciliationProduct: 'f4000000-0000-4000-8000-000000000002',
  massBatch: 'f5000000-0000-4000-8000-000000000001',
  associateBatch: 'f5000000-0000-4000-8000-000000000002',
  updateBatch: 'f5000000-0000-4000-8000-000000000003',
  masterMissingStrategyBatch: 'f5000000-0000-4000-8000-000000000004',
  masterIgnoreBatch: 'f5000000-0000-4000-8000-000000000005',
  masterReconcileBatch: 'f5000000-0000-4000-8000-000000000006',
  rollbackBatch: 'f5000000-0000-4000-8000-000000000007',
  conflictBatch: 'f5000000-0000-4000-8000-000000000008',
  unclassifiedBatch: 'f5000000-0000-4000-8000-000000000009',
  unauthorizedBatch: 'f5000000-0000-4000-8000-000000000010',
} as const;

type ValidationState = 'VALID' | 'WARNING' | 'ERROR' | 'CONFLICT' | 'IGNORED' | null;
type DryRunAction = 'NEW' | 'UPDATE_CANDIDATE' | 'CONFLICT' | 'IGNORED' | null;

interface StagedFixtureRow {
  rowNumber: number;
  normalizedData: Readonly<Record<string, string | null>> | null;
  validationState: ValidationState;
  dryRunAction: DryRunAction;
  resolvedEntityId?: string;
  categoryCandidate?: Readonly<Record<string, unknown>>;
  validationErrors?: readonly Readonly<Record<string, unknown>>[];
}

interface CreateBatchInput {
  id: string;
  sourceName: string;
  rows: readonly StagedFixtureRow[];
  approvedCategories?: readonly string[];
  withQuantity?: boolean;
}

interface ConfirmationResult {
  batch_id: string;
  import_mode: 'INITIAL_MIGRATION' | 'MASTER_DATA_IMPORT';
  applied: boolean;
  products_created: number;
  products_associated: number;
  products_updated: number;
  categories_created: number;
  movements_created: number;
  lines_ignored: number;
  external_quantities_ignored: number;
  warnings: number;
  errors: number;
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

async function queryAs<T>(
  databaseRole: 'anon' | 'authenticated',
  userId: string | undefined,
  sql: string,
): Promise<readonly T[]> {
  await assumeIdentity(databaseRole, userId);
  try {
    const result = await database.query<T>(sql);
    return result.rows;
  } finally {
    await resetIdentity();
  }
}

function onlyResult<T>(rows: readonly T[]): T {
  expect(rows).toHaveLength(1);
  const result = rows[0];
  if (result === undefined) throw new Error('Expected exactly one result');
  return result;
}

async function scalar(sql: string): Promise<string> {
  const result = await database.query<{ value: string }>(sql);
  return result.rows[0]?.value ?? '';
}

function productData(
  sku: string,
  name: string,
  category: string,
  options: {
    ean?: string;
    externalId?: string;
    openingQuantity?: string;
    minimumQuantity?: string;
  } = {},
): Readonly<Record<string, string | null>> {
  return {
    sku,
    name,
    ean: options.ean ?? null,
    external_id: options.externalId ?? null,
    opening_quantity: options.openingQuantity ?? null,
    minimum_quantity: options.minimumQuantity ?? '0.000',
    unit: 'KG',
    category,
    product_type: 'RAW',
  };
}

async function createBatch(input: CreateBatchInput): Promise<void> {
  const mapping = [
    { sourceColumn: 'SKU', targetField: 'sku' },
    { sourceColumn: 'NOME', targetField: 'name' },
    { sourceColumn: 'CATEGORIA', targetField: 'category' },
    ...(input.withQuantity ? [{ sourceColumn: 'SALDO', targetField: 'opening_quantity' }] : []),
  ];
  const validRows = input.rows.filter(
    ({ validationState }) => validationState === 'VALID' || validationState === 'WARNING',
  ).length;
  const invalidRows = input.rows.filter(
    ({ validationState }) => validationState === 'ERROR' || validationState === 'CONFLICT',
  ).length;

  await database.query(
    `insert into public.import_batches (
      id, source_type, source_name, file_hash, status, total_rows, valid_rows, invalid_rows,
      created_by, column_mapping, approved_category_creations, dry_run_summary
    ) values (
      $1, 'CSV', $2, $3, 'READY', $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb
    );`,
    [
      input.id,
      input.sourceName,
      `confirmation:${input.id}`,
      input.rows.length,
      validRows,
      invalidRows,
      ids.admin,
      JSON.stringify(mapping),
      JSON.stringify(input.approvedCategories ?? []),
      JSON.stringify({ TOTAL: input.rows.length }),
    ],
  );

  const records = input.rows.map((row) => ({
    row_number: row.rowNumber,
    raw_data: { fixture: String(row.rowNumber) },
    normalized_data: row.normalizedData,
    validation_status:
      row.validationState === 'ERROR' || row.validationState === 'CONFLICT'
        ? 'INVALID'
        : row.validationState === 'IGNORED'
          ? 'RESOLVED'
          : 'VALID',
    validation_state: row.validationState,
    dry_run_action: row.dryRunAction,
    resolved_entity_id: row.resolvedEntityId ?? null,
    category_candidate: row.categoryCandidate ?? null,
    validation_errors: row.validationErrors ?? [],
  }));

  await database.query(
    `insert into public.import_rows (
      import_batch_id, row_number, raw_data, normalized_data, validation_status,
      validation_state, dry_run_action, resolved_entity_id, category_candidate, validation_errors
    )
    select
      $1,
      staged.row_number,
      staged.raw_data,
      staged.normalized_data,
      staged.validation_status::public.import_row_validation_status,
      staged.validation_state::public.import_row_validation_state,
      staged.dry_run_action::public.import_row_dry_run_action,
      staged.resolved_entity_id,
      staged.category_candidate,
      staged.validation_errors
    from jsonb_to_recordset($2::jsonb) as staged(
      row_number integer,
      raw_data jsonb,
      normalized_data jsonb,
      validation_status text,
      validation_state text,
      dry_run_action text,
      resolved_entity_id uuid,
      category_candidate jsonb,
      validation_errors jsonb
    );`,
    [input.id, JSON.stringify(records)],
  );
}

function confirmSql(
  batchId: string,
  mode: 'INITIAL_MIGRATION' | 'MASTER_DATA_IMPORT',
  productStrategy: 'ASSOCIATE_ONLY' | 'UPDATE_MASTER_DATA',
  stockLocationId: string | null,
  quantityStrategy: 'IGNORE_EXTERNAL_QUANTITY' | 'RECONCILE_TO_EXTERNAL_QUANTITY' | null,
): string {
  const location = stockLocationId === null ? 'null' : `'${stockLocationId}'`;
  const quantity = quantityStrategy === null ? 'null' : `'${quantityStrategy}'`;
  return `select * from public.confirm_product_import(
    '${batchId}', '${mode}', '${productStrategy}', ${location}, ${quantity}
  );`;
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
      ('${ids.viewer}', 'viewer@example.com');

    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.admin}', id, '${ids.admin}' from public.roles where code = 'ADMIN';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.operator}', id, '${ids.admin}' from public.roles where code = 'STOCK_OPERATOR';
    insert into public.user_roles (profile_id, role_id, granted_by)
    select '${ids.viewer}', id, '${ids.admin}' from public.roles where code = 'VIEWER';

    insert into public.locations (id, name, location_type, created_by, updated_by)
    values ('${ids.location}', 'Estoque da migração', 'STOCK', '${ids.admin}', '${ids.admin}');
    insert into public.categories (id, name, created_by, updated_by)
    values ('${ids.category}', 'Existente', '${ids.admin}', '${ids.admin}');
    insert into public.products (
      id, name, sku, product_type, unit, category_id, minimum_quantity, created_by, updated_by
    ) values
      ('${ids.associatedProduct}', 'Produto original', 'EXISTING-001', 'RAW', 'KG',
       '${ids.category}', 1, '${ids.admin}', '${ids.admin}'),
      ('${ids.reconciliationProduct}', 'Produto reconciliado', 'RECONCILE-001', 'RAW', 'KG',
       '${ids.category}', 0, '${ids.admin}', '${ids.admin}');
    insert into public.stock_balances (product_id, quantity)
    values ('${ids.reconciliationProduct}', 12);

    create function private.fail_confirmation_fixture_balance()
    returns trigger
    language plpgsql
    set search_path = pg_catalog
    as $$
    begin
      if exists (
        select 1 from public.products product
        where product.id = new.product_id and product.sku = 'ROLLBACK-002'
      ) then
        raise exception 'forced confirmation rollback';
      end if;
      return new;
    end;
    $$;
    create trigger stock_balances_force_confirmation_rollback
    before update on public.stock_balances
    for each row execute function private.fail_confirmation_fixture_balance();
  `);
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('confirmação definitiva de produtos importados', () => {
  it('promove centenas de linhas na migração inicial e repete o batch sem duplicar efeitos', async () => {
    const categoryNames = Array.from(
      { length: 10 },
      (_, index) => `Categoria ${String(index + 1).padStart(2, '0')}`,
    );
    const actionableRows: StagedFixtureRow[] = Array.from({ length: 200 }, (_, index) => {
      const category = categoryNames[index % categoryNames.length] ?? 'Categoria 01';
      return {
        rowNumber: index + 1,
        normalizedData: productData(
          `MASS-${String(index + 1).padStart(4, '0')}`,
          `Produto em massa ${String(index + 1)}`,
          category,
          {
            ...(index === 0 ? { ean: '7894900011517' } : {}),
            externalId: `LEGACY-${String(index + 1).padStart(4, '0')}`,
            openingQuantity: `${String((index % 5) + 1)}.000`,
            minimumQuantity: '1.000',
          },
        ),
        validationState: 'WARNING',
        dryRunAction: 'NEW',
        categoryCandidate: {
          normalizedName: category,
          sourceValue: category,
          approvedForCreation: true,
        },
        validationErrors: [{ code: 'CATEGORY_CREATION_CANDIDATE', severity: 'WARNING' }],
      };
    });
    const ignoredRows: StagedFixtureRow[] = Array.from({ length: 20 }, (_, index) => ({
      rowNumber: actionableRows.length + index + 1,
      normalizedData: null,
      validationState: 'IGNORED',
      dryRunAction: 'IGNORED',
    }));
    await createBatch({
      id: ids.massBatch,
      sourceName: 'Mass Legacy',
      rows: [...actionableRows, ...ignoredRows],
      approvedCategories: categoryNames,
      withQuantity: true,
    });

    const first = onlyResult(
      await queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.massBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', ids.location, null),
      ),
    );
    expect(first).toMatchObject({
      applied: true,
      products_created: 200,
      products_associated: 0,
      categories_created: 10,
      movements_created: 200,
      lines_ignored: 20,
      warnings: 200,
      errors: 0,
    });
    expect(
      await scalar(`select count(*)::text as value from public.products where sku like 'MASS-%';`),
    ).toBe('200');
    expect(
      await scalar(
        `select count(*)::text as value from public.external_entity_mappings where source_system = 'Mass Legacy';`,
      ),
    ).toBe('200');
    expect(await scalar(`select ean as value from public.products where sku = 'MASS-0001';`)).toBe(
      '7894900011517',
    );
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where import_batch_id = '${ids.massBatch}';`,
      ),
    ).toBe('200');
    expect(
      await scalar(
        `select count(*)::text as value from public.import_rows where import_batch_id = '${ids.massBatch}' and promotion_action = 'CREATED';`,
      ),
    ).toBe('200');
    expect(
      await scalar(
        `select status::text as value from public.import_batches where id = '${ids.massBatch}';`,
      ),
    ).toBe('COMPLETED');

    const replay = onlyResult(
      await queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.massBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', ids.location, null),
      ),
    );
    expect(replay).toEqual({ ...first, applied: false });
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where import_batch_id = '${ids.massBatch}';`,
      ),
    ).toBe('200');
  }, 60_000);

  it('associa produto existente e só atualiza cadastro quando a estratégia permite', async () => {
    await createBatch({
      id: ids.associateBatch,
      sourceName: 'Legacy Associate',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('EXISTING-001', 'Nome ignorado', 'Existente', {
            externalId: 'EXT-ASSOCIATE-1',
            minimumQuantity: '9.000',
          }),
          validationState: 'VALID',
          dryRunAction: 'UPDATE_CANDIDATE',
          resolvedEntityId: ids.associatedProduct,
        },
      ],
    });
    const associated = onlyResult(
      await queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.associateBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', null, null),
      ),
    );
    expect(associated).toMatchObject({ products_associated: 1, products_updated: 0 });
    expect(
      await scalar(
        `select name as value from public.products where id = '${ids.associatedProduct}';`,
      ),
    ).toBe('Produto original');

    await createBatch({
      id: ids.updateBatch,
      sourceName: 'Master Update',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('EXISTING-001', 'Produto atualizado', 'Existente', {
            minimumQuantity: '4.000',
          }),
          validationState: 'VALID',
          dryRunAction: 'UPDATE_CANDIDATE',
          resolvedEntityId: ids.associatedProduct,
        },
      ],
    });
    const updated = onlyResult(
      await queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.updateBatch, 'MASTER_DATA_IMPORT', 'UPDATE_MASTER_DATA', null, null),
      ),
    );
    expect(updated).toMatchObject({ products_associated: 1, products_updated: 1 });
    expect(
      await scalar(
        `select name || ':' || minimum_quantity::text as value from public.products where id = '${ids.associatedProduct}';`,
      ),
    ).toBe('Produto atualizado:4.000');
  });

  it('exige decisão explícita para quantidade mestre e permite ignorar sem alterar saldo', async () => {
    const row: StagedFixtureRow = {
      rowNumber: 1,
      normalizedData: productData('RECONCILE-001', 'Produto reconciliado', 'Existente', {
        openingQuantity: '7.000',
      }),
      validationState: 'VALID',
      dryRunAction: 'UPDATE_CANDIDATE',
      resolvedEntityId: ids.reconciliationProduct,
    };
    await createBatch({
      id: ids.masterMissingStrategyBatch,
      sourceName: 'Master Missing Strategy',
      rows: [row],
      withQuantity: true,
    });
    await expect(
      queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(
          ids.masterMissingStrategyBatch,
          'MASTER_DATA_IMPORT',
          'ASSOCIATE_ONLY',
          null,
          null,
        ),
      ),
    ).rejects.toThrow(/explicit external quantity strategy/i);
    expect(
      await scalar(
        `select status::text as value from public.import_batches where id = '${ids.masterMissingStrategyBatch}';`,
      ),
    ).toBe('READY');

    await createBatch({
      id: ids.masterIgnoreBatch,
      sourceName: 'Master Ignore Quantity',
      rows: [row],
      withQuantity: true,
    });
    const ignored = onlyResult(
      await queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(
          ids.masterIgnoreBatch,
          'MASTER_DATA_IMPORT',
          'ASSOCIATE_ONLY',
          null,
          'IGNORE_EXTERNAL_QUANTITY',
        ),
      ),
    );
    expect(ignored).toMatchObject({
      movements_created: 0,
      external_quantities_ignored: 1,
    });
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.reconciliationProduct}';`,
      ),
    ).toBe('12.000');
  });

  it('reconcilia quantidade mestre exclusivamente por movimento vinculado ao batch', async () => {
    await createBatch({
      id: ids.masterReconcileBatch,
      sourceName: 'Master Reconcile Quantity',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('RECONCILE-001', 'Produto reconciliado', 'Existente', {
            openingQuantity: '7.000',
          }),
          validationState: 'VALID',
          dryRunAction: 'UPDATE_CANDIDATE',
          resolvedEntityId: ids.reconciliationProduct,
        },
      ],
      withQuantity: true,
    });
    const result = onlyResult(
      await queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(
          ids.masterReconcileBatch,
          'MASTER_DATA_IMPORT',
          'ASSOCIATE_ONLY',
          ids.location,
          'RECONCILE_TO_EXTERNAL_QUANTITY',
        ),
      ),
    );
    expect(result.movements_created).toBe(1);
    expect(
      await scalar(
        `select quantity::text as value from public.stock_balances where product_id = '${ids.reconciliationProduct}';`,
      ),
    ).toBe('7.000');
    expect(
      await scalar(
        `select movement_type::text || ':' || quantity::text as value
         from public.stock_movements where import_batch_id = '${ids.masterReconcileBatch}';`,
      ),
    ).toBe('ADJUSTMENT_NEGATIVE:5.000');
  });

  it('reverte categorias, produtos e movimentos quando uma linha falha no meio da confirmação', async () => {
    const category = 'Categoria de rollback';
    await createBatch({
      id: ids.rollbackBatch,
      sourceName: 'Rollback Legacy',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('ROLLBACK-001', 'Rollback um', category, {
            openingQuantity: '2.000',
          }),
          validationState: 'WARNING',
          dryRunAction: 'NEW',
          categoryCandidate: {
            normalizedName: category,
            sourceValue: category,
            approvedForCreation: true,
          },
        },
        {
          rowNumber: 2,
          normalizedData: productData('ROLLBACK-002', 'Rollback dois', category, {
            openingQuantity: '3.000',
          }),
          validationState: 'WARNING',
          dryRunAction: 'NEW',
          categoryCandidate: {
            normalizedName: category,
            sourceValue: category,
            approvedForCreation: true,
          },
        },
      ],
      approvedCategories: [category],
      withQuantity: true,
    });

    await expect(
      queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.rollbackBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', ids.location, null),
      ),
    ).rejects.toThrow(/forced confirmation rollback/i);
    expect(
      await scalar(
        `select count(*)::text as value from public.products where sku like 'ROLLBACK-%';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select count(*)::text as value from public.categories where name = '${category}';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select count(*)::text as value from public.stock_movements where import_batch_id = '${ids.rollbackBatch}';`,
      ),
    ).toBe('0');
    expect(
      await scalar(
        `select status::text as value from public.import_batches where id = '${ids.rollbackBatch}';`,
      ),
    ).toBe('READY');
    expect(
      await scalar(
        `select count(*)::text as value from public.import_rows where import_batch_id = '${ids.rollbackBatch}' and promotion_action is not null;`,
      ),
    ).toBe('0');
  });

  it('bloqueia conflitos, linhas não classificadas e usuários sem ADMIN', async () => {
    await createBatch({
      id: ids.conflictBatch,
      sourceName: 'Conflict Legacy',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('CONFLICT-001', 'Conflito', 'Existente'),
          validationState: 'CONFLICT',
          dryRunAction: 'CONFLICT',
        },
      ],
    });
    await expect(
      queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.conflictBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', null, null),
      ),
    ).rejects.toThrow(/critical conflicts/i);

    await createBatch({
      id: ids.unclassifiedBatch,
      sourceName: 'Unclassified Legacy',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('UNCLASSIFIED-001', 'Sem classificação', 'Existente'),
          validationState: null,
          dryRunAction: null,
        },
      ],
    });
    await expect(
      queryAs<ConfirmationResult>(
        'authenticated',
        ids.admin,
        confirmSql(ids.unclassifiedBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', null, null),
      ),
    ).rejects.toThrow(/all import rows must be classified/i);

    await createBatch({
      id: ids.unauthorizedBatch,
      sourceName: 'Unauthorized Legacy',
      rows: [
        {
          rowNumber: 1,
          normalizedData: productData('UNAUTHORIZED-001', 'Sem permissão', 'Existente'),
          validationState: 'VALID',
          dryRunAction: 'NEW',
        },
      ],
    });
    await expect(
      queryAs<ConfirmationResult>(
        'authenticated',
        ids.operator,
        confirmSql(ids.unauthorizedBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', null, null),
      ),
    ).rejects.toThrow(/active ADMIN user is required/i);
    await expect(
      queryAs<ConfirmationResult>(
        'authenticated',
        ids.viewer,
        confirmSql(ids.unauthorizedBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', null, null),
      ),
    ).rejects.toThrow(/active ADMIN user is required/i);
    await expect(
      queryAs<ConfirmationResult>(
        'anon',
        undefined,
        confirmSql(ids.unauthorizedBatch, 'INITIAL_MIGRATION', 'ASSOCIATE_ONLY', null, null),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
