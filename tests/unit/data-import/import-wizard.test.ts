import { describe, expect, it } from 'vitest';

import {
  inspectProductImportFile,
  isProductImportConfirmable,
  prepareProductImport,
  serializeImportReport,
  type ColumnMapping,
  type ProductImportPreviewSummary,
} from '../../../src/modules/data-import';
import {
  categoryCandidates,
  dryRunCards,
  targetsForMode,
} from '../../../src/app/features/imports/import-wizard-state';
import { createCsvFile } from '../../fixtures/tabular-files';

const mapping: readonly ColumnMapping[] = [
  { sourceColumn: 'CODIGO', targetField: 'sku' },
  { sourceColumn: 'DESCRICAO', targetField: 'name' },
  { sourceColumn: 'SALDO', targetField: 'opening_quantity' },
  { sourceColumn: 'UNIDADE', targetField: 'unit' },
  { sourceColumn: 'GRUPO', targetField: 'category' },
  { sourceColumn: 'TIPO', targetField: 'product_type' },
  { sourceColumn: 'PRECO', targetField: 'IGNORE' },
];

const readySummary: ProductImportPreviewSummary = {
  TOTAL: 600,
  VALID: 600,
  INVALID: 0,
  NEW: 583,
  UPDATE_CANDIDATE: 17,
  CONFLICT: 0,
  IGNORED: 0,
  WARNING: 8,
  CATEGORIES_NEW: 8,
};

describe('assistente de importação e migração', () => {
  it('identifica cabeçalhos desconhecidos e valores distintos sem presumir nomes', async () => {
    const inspection = await inspectProductImportFile({
      file: createCsvFile(
        [
          'CODIGO;DESCRICAO;SALDO;UNIDADE;GRUPO;TIPO;PRECO',
          '001;Arroz;12,5;KILO;Secos;BRUTO;9,90',
          '002;Feijão;2;UND;Secos;FRACIONADO;8,50',
        ].join('\n'),
      ),
    });

    expect(inspection.headers).toEqual([
      'CODIGO',
      'DESCRICAO',
      'SALDO',
      'UNIDADE',
      'GRUPO',
      'TIPO',
      'PRECO',
    ]);
    expect(inspection.distinctValues.UNIDADE).toEqual(['KILO', 'UND']);
    expect(inspection.sampleRows).toHaveLength(2);
    expect(inspection.fileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('aplica ColumnMapping e ValueMapping configuráveis antes de enviar ao staging', async () => {
    const inspection = await inspectProductImportFile({
      file: createCsvFile(
        'CODIGO;DESCRICAO;SALDO;UNIDADE;GRUPO;TIPO;PRECO\n001;Arroz;12,5;KILO;Secos;BRUTO;9,90',
      ),
    });
    const prepared = prepareProductImport({
      mode: 'INITIAL_MIGRATION',
      inspection,
      mapping,
      valueMappings: {
        unit: [{ sourceValue: 'KILO', targetValue: 'KG' }],
        productType: [{ sourceValue: 'BRUTO', targetValue: 'RAW' }],
      },
    });

    expect(prepared.summary).toEqual({
      total: 1,
      valid: 1,
      warnings: 0,
      errors: 0,
      conflicts: 0,
      ignored: 0,
    });
    expect(prepared.rows[0]?.normalizedData).toMatchObject({
      sku: '001',
      name: 'Arroz',
      opening_quantity: '12.500',
      unit: 'KG',
      category: 'Secos',
      product_type: 'RAW',
    });
    expect(prepared.rows[0]?.normalizedData).not.toHaveProperty('PRECO');
  });

  it('bloqueia quantidade atual no modo de cadastro futuro', async () => {
    const inspection = await inspectProductImportFile({
      file: createCsvFile(
        'CODIGO;DESCRICAO;SALDO;UNIDADE;GRUPO;TIPO;PRECO\n001;Arroz;12;KG;Secos;RAW;9',
      ),
    });

    expect(() => prepareProductImport({ mode: 'MASTER_DATA_IMPORT', inspection, mapping })).toThrow(
      /reconciliação de estoque/,
    );
    expect(targetsForMode('MASTER_DATA_IMPORT')).not.toContain('opening_quantity');
    expect(targetsForMode('INITIAL_MIGRATION')).toContain('opening_quantity');
  });

  it('só libera confirmação quando não há erro ou conflito crítico', () => {
    expect(isProductImportConfirmable(readySummary)).toBe(true);
    expect(isProductImportConfirmable({ ...readySummary, INVALID: 1 })).toBe(false);
    expect(isProductImportConfirmable({ ...readySummary, INVALID: 1, CONFLICT: 1 })).toBe(false);
    expect(dryRunCards(readySummary).map(({ value }) => value)).toEqual([583, 17, 8, 0, 0, 0]);
  });

  it('consolida categorias candidatas e gera relatório CSV rastreável', () => {
    expect(
      categoryCandidates([
        {
          rowNumber: 2,
          rawData: {},
          normalizedData: null,
          state: 'WARNING',
          action: 'NEW',
          issues: [],
          categoryCandidate: {
            normalizedName: 'Secos',
            sourceValue: 'SECOS',
            approvedForCreation: false,
          },
        },
        {
          rowNumber: 3,
          rawData: {},
          normalizedData: null,
          state: 'WARNING',
          action: 'NEW',
          issues: [],
          categoryCandidate: {
            normalizedName: 'Secos',
            sourceValue: 'Secos',
            approvedForCreation: false,
          },
        },
      ]),
    ).toEqual(['Secos']);

    const csv = serializeImportReport({
      report: {
        batchId: 'batch-600',
        importMode: 'INITIAL_MIGRATION',
        applied: true,
        productsCreated: 583,
        productsAssociated: 17,
        productsUpdated: 0,
        categoriesCreated: 8,
        movementsCreated: 600,
        linesIgnored: 2,
        externalQuantitiesIgnored: 0,
        warnings: 3,
        errors: 0,
      },
      startedAt: '2026-08-20T20:00:00.000Z',
      finishedAt: '2026-08-20T20:00:05.000Z',
      elapsedMilliseconds: 5000,
      filename: 'produtos.csv',
      sourceName: 'Sistema legado',
    });

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('export_schema_version;1');
    expect(csv).toContain('batch_id;batch-600');
    expect(csv).toContain('movimentacoes_criadas;600');
    expect(csv).not.toMatch(/token|service_role|password/i);
  });
});
