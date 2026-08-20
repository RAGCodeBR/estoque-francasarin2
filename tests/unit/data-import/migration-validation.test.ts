import { describe, expect, it } from 'vitest';

import {
  assertImportConfirmable,
  ImportFileError,
  runImportDryRun,
  type CategoryLookup,
  type ColumnMapping,
  type ImportStagingRepository,
  type ProductLookup,
} from '../../../src/modules/data-import';
import type {
  ProductIdentityMatch,
  RawImportData,
} from '../../../src/modules/data-import/domain/types';
import type {
  DuplicateImportBatch,
  SaveDryRunInput,
  StagedBatchData,
} from '../../../src/modules/data-import/ports/staging-repository';

const headers = [
  'COD',
  'NOME',
  'EAN',
  'ID_EXTERNO',
  'SALDO',
  'MINIMO',
  'UNIDADE',
  'CATEGORIA',
  'TIPO',
];
const mapping: readonly ColumnMapping[] = [
  { sourceColumn: 'COD', targetField: 'sku' },
  { sourceColumn: 'NOME', targetField: 'name' },
  { sourceColumn: 'EAN', targetField: 'ean' },
  { sourceColumn: 'ID_EXTERNO', targetField: 'external_id' },
  { sourceColumn: 'SALDO', targetField: 'opening_quantity' },
  { sourceColumn: 'MINIMO', targetField: 'minimum_quantity' },
  { sourceColumn: 'UNIDADE', targetField: 'unit' },
  { sourceColumn: 'CATEGORIA', targetField: 'category' },
  { sourceColumn: 'TIPO', targetField: 'product_type' },
];

class ValidationRepository implements ImportStagingRepository {
  readonly dryRuns: SaveDryRunInput[] = [];

  constructor(private readonly batch: StagedBatchData) {}

  findOriginalByFileHash(): Promise<DuplicateImportBatch | null> {
    return Promise.resolve(null);
  }

  createBatchWithRows(): Promise<string> {
    return Promise.reject(new Error('Este teste usa staging já preparado.'));
  }

  loadBatch(): Promise<StagedBatchData> {
    return Promise.resolve(this.batch);
  }

  saveDryRun(_batchId: string, input: SaveDryRunInput): Promise<void> {
    this.dryRuns.push(input);
    return Promise.resolve();
  }
}

function raw(values: readonly (string | null)[]): RawImportData {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]));
}

function repositoryFor(...rows: readonly (string | null)[][]): ValidationRepository {
  return new ValidationRepository({
    id: 'batch-1',
    sourceName: 'ERP legado',
    headers,
    rows: rows.map((values, index) => ({ rowNumber: index + 2, rawData: raw(values) })),
  });
}

const emptyProducts: ProductLookup = {
  findIdentityMatches() {
    return Promise.resolve([]);
  },
  suggestBySimilarNames() {
    return Promise.resolve([]);
  },
};

const existingCategories: CategoryLookup = {
  findByNormalizedNames(names) {
    return Promise.resolve(names.map((name) => ({ id: `category-${name}`, name })));
  },
};

const noCategories: CategoryLookup = {
  findByNormalizedNames() {
    return Promise.resolve([]);
  },
};

describe('regras de mapeamento e validação da migração', () => {
  it('normaliza aliases padrão e ValueMapping customizado sem depender do cabeçalho externo', async () => {
    const repository = repositoryFor(
      ['001', 'Carne', '7894900011517', 'LEG-1', '10,5', '2', 'UNID', 'Carnes', 'BRUTO'],
      ['002', 'Farinha', null, 'LEG-2', '5', '1,25', 'SACO', 'Mercearia', 'X'],
    );

    const result = await runImportDryRun({
      batchId: 'batch-1',
      mapping,
      repository,
      productLookup: emptyProducts,
      categoryLookup: existingCategories,
      normalization: {
        valueMappings: {
          unit: [{ sourceValue: 'SACO', targetValue: 'KG' }],
          productType: [{ sourceValue: 'X', targetValue: 'RAW' }],
        },
      },
    });

    expect(result.summary).toMatchObject({ TOTAL: 2, VALID: 2, NEW: 2, INVALID: 0 });
    expect(result.rows[0]).toMatchObject({
      state: 'VALID',
      normalizedData: {
        ean: '7894900011517',
        opening_quantity: '10.500',
        minimum_quantity: '2.000',
        unit: 'UN',
        product_type: 'RAW',
      },
    });
    expect(result.rows[1]?.normalizedData).toMatchObject({
      minimum_quantity: '1.250',
      unit: 'KG',
      product_type: 'RAW',
    });
    expect(repository.dryRuns[0]).toMatchObject({
      valueMappingVersion: 1,
      valueMapping: {
        unit: [{ sourceValue: 'SACO', targetValue: 'KG' }],
        productType: [{ sourceValue: 'X', targetValue: 'RAW' }],
      },
    });
  });

  it('retorna erros estruturados com linha, campo, valor, problema e correção sugerida', async () => {
    const repository = repositoryFor([
      '001',
      null,
      '7894900011518',
      null,
      '-1',
      '-0,001',
      'LITRO',
      null,
      'DESCONHECIDO',
    ]);

    const result = await runImportDryRun({
      batchId: 'batch-1',
      mapping,
      repository,
      productLookup: emptyProducts,
      categoryLookup: existingCategories,
    });

    expect(result.summary).toMatchObject({ INVALID: 1, VALID: 0 });
    expect(result.rows[0]).toMatchObject({ state: 'ERROR', action: null });
    expect(result.rows[0]?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['REQUIRED', 'INVALID_EAN', 'NEGATIVE_QUANTITY', 'UNEXPECTED_VALUE']),
    );
    for (const issue of result.rows[0]?.issues ?? []) {
      expect(issue.rowNumber).toBe(2);
      expect(typeof issue.field).toBe('string');
      expect(typeof issue.problem).toBe('string');
      expect(typeof issue.suggestedCorrection).toBe('string');
      expect('value' in issue).toBe(true);
    }
    expect(() => {
      assertImportConfirmable(result);
    }).toThrow(ImportFileError);
  });

  it('marca categoria inexistente como candidata e exige aprovação explícita para confirmar', async () => {
    const values = ['001', 'Carne', null, null, '0', '1', 'KG', 'Carnes', 'RAW'] as const;
    const pending = await runImportDryRun({
      batchId: 'batch-1',
      mapping,
      repository: repositoryFor([...values]),
      productLookup: emptyProducts,
      categoryLookup: noCategories,
    });

    expect(pending.rows[0]).toMatchObject({
      state: 'WARNING',
      action: 'NEW',
      categoryCandidate: {
        normalizedName: 'Carnes',
        approvedForCreation: false,
      },
    });
    expect(() => {
      assertImportConfirmable(pending);
    }).toThrow(/categorias candidatas ainda não aprovadas/i);

    const approvedCategoryRepository = repositoryFor([...values]);
    const approved = await runImportDryRun({
      batchId: 'batch-1',
      mapping,
      repository: approvedCategoryRepository,
      productLookup: emptyProducts,
      categoryLookup: noCategories,
      approvedCategoryCreations: ['  CARNES  '],
    });
    expect(approved.rows[0]?.categoryCandidate?.approvedForCreation).toBe(true);
    expect(approvedCategoryRepository.dryRuns[0]?.approvedCategoryCreations).toEqual(['carnes']);
    expect(() => {
      assertImportConfirmable(approved);
    }).not.toThrow();
  });

  it('identifica por mapeamento externo, SKU e EAN, mas nunca resolve por nome semelhante', async () => {
    const product = {
      id: 'product-a',
      sku: 'SKU-A',
      ean: '7894900011517',
      name: 'Filé de frango',
      unit: 'KG' as const,
      category: 'Carnes',
      productType: 'RAW' as const,
      minimumQuantity: '1.000',
    };
    const repository = repositoryFor(
      ['COD-LEGADO', 'Filé de frango', null, 'EXT-A', '0', '1', 'KG', 'Carnes', 'RAW'],
      ['SKU-A', 'Filé de frango', '7894900011517', null, '0', '1', 'KG', 'Carnes', 'RAW'],
      ['NOVO', 'File Frango', null, null, '0', '1', 'KG', 'Carnes', 'RAW'],
    );
    const productLookup: ProductLookup = {
      findIdentityMatches(queries) {
        return Promise.resolve(
          queries.flatMap((query): ProductIdentityMatch[] => {
            if (query.externalId === 'EXT-A') {
              return [{ rowNumber: query.rowNumber, matchedBy: 'EXTERNAL_MAPPING', product }];
            }
            if (query.sku === 'SKU-A') {
              return [
                { rowNumber: query.rowNumber, matchedBy: 'SKU', product },
                { rowNumber: query.rowNumber, matchedBy: 'EAN', product },
              ];
            }
            return [];
          }),
        );
      },
      suggestBySimilarNames(queries) {
        const query = queries.find(({ name }) => name === 'File Frango');
        return Promise.resolve(
          query ? [{ rowNumber: query.rowNumber, product, confidence: 0.91 }] : [],
        );
      },
    };

    const result = await runImportDryRun({
      batchId: 'batch-1',
      mapping,
      repository,
      productLookup,
      categoryLookup: existingCategories,
    });

    expect(result.rows[0]).toMatchObject({
      action: 'UPDATE_CANDIDATE',
      resolvedEntityId: 'product-a',
      matchedBy: 'EXTERNAL_MAPPING',
    });
    expect(result.rows[1]).toMatchObject({
      action: 'IGNORED',
      resolvedEntityId: 'product-a',
      matchedBy: 'SKU',
    });
    expect(result.rows[2]).toMatchObject({ state: 'WARNING', action: 'NEW' });
    expect(result.rows[2]?.resolvedEntityId).toBeUndefined();
    expect(result.rows[2]?.suggestions).toEqual([
      expect.objectContaining({ productId: 'product-a', reason: 'SIMILAR_NAME' }),
    ]);
  });

  it('transforma identificadores contraditórios em conflito crítico não confirmável', async () => {
    const productA = {
      id: 'product-a',
      sku: 'A',
      name: 'Produto A',
      unit: 'UN' as const,
      category: 'Geral',
      productType: 'RAW' as const,
    };
    const productB = { ...productA, id: 'product-b', sku: 'B', name: 'Produto B' };
    const repository = repositoryFor([
      'B',
      'Produto',
      null,
      'EXT-A',
      '0',
      '0',
      'UN',
      'Geral',
      'RAW',
    ]);
    const productLookup: ProductLookup = {
      findIdentityMatches(queries) {
        const rowNumber = queries[0]?.rowNumber ?? 2;
        return Promise.resolve([
          { rowNumber, matchedBy: 'EXTERNAL_MAPPING', product: productA },
          { rowNumber, matchedBy: 'SKU', product: productB },
        ]);
      },
      suggestBySimilarNames() {
        return Promise.resolve([]);
      },
    };

    const result = await runImportDryRun({
      batchId: 'batch-1',
      mapping,
      repository,
      productLookup,
      categoryLookup: existingCategories,
    });

    expect(result.rows[0]).toMatchObject({ state: 'CONFLICT', action: 'CONFLICT' });
    expect(result.rows[0]?.issues).toEqual([
      expect.objectContaining({ code: 'CONTRADICTORY_PRODUCT_IDENTIFIERS' }),
    ]);
    expect(() => {
      assertImportConfirmable(result);
    }).toThrow(/conflitos críticos/i);
  });

  it('rejeita ValueMapping contraditório em vez de escolher silenciosamente', async () => {
    await expect(
      runImportDryRun({
        batchId: 'batch-1',
        mapping,
        repository: repositoryFor(['001', 'Item', null, null, '0', '0', 'X', 'Geral', 'RAW']),
        productLookup: emptyProducts,
        categoryLookup: existingCategories,
        normalization: {
          valueMappings: {
            unit: [
              { sourceValue: 'X', targetValue: 'UN' },
              { sourceValue: 'x', targetValue: 'KG' },
            ],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_VALUE_MAPPING' });
  });
});
