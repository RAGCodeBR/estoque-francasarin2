import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { previewOperationalImport } from '../../src/modules/data-import';
import type {
  OperationalColumnMapping,
  OperationalImportRepository,
  OperationalImportType,
  OperationalPreviewPage,
  OperationalPreviewSummary,
  StageOperationalPreviewInput,
} from '../../src/modules/data-import/domain/operational-types';
import { getExportDefinition, serializeExport } from '../../src/modules/data-export';
import type { ExportRow } from '../../src/modules/data-export/domain/types';

const emptySummary: OperationalPreviewSummary = {
  TOTAL: 0,
  VALID: 0,
  INVALID: 0,
  NEW: 0,
  UPDATE_CANDIDATE: 0,
  CONFLICT: 0,
  IGNORED: 0,
  POSITIVE: 0,
  NEGATIVE: 0,
  UNCHANGED: 0,
};

const portableRows: readonly ExportRow[] = [
  {
    product_id: '91000000-0000-4000-8000-000000000001',
    sku: 'PORT-001',
    ean: '7894900011517',
    name: 'Café torrado',
    category_id: '92000000-0000-4000-8000-000000000001',
    category: 'Mercearia',
    product_type: 'RAW',
    unit: 'KG',
    current_quantity: '12.500',
    minimum_quantity: '3.000',
    situation: 'OK',
    active: true,
    stock_updated_at: '2026-08-21T12:00:00.000Z',
    product_updated_at: '2026-08-21T11:00:00.000Z',
  },
  {
    product_id: '91000000-0000-4000-8000-000000000002',
    sku: 'PORT-002',
    ean: null,
    name: 'Guardanapo',
    category_id: '92000000-0000-4000-8000-000000000002',
    category: 'Descartáveis',
    product_type: 'FRACTIONATED',
    unit: 'UN',
    current_quantity: '40.000',
    minimum_quantity: '10.000',
    situation: 'OK',
    active: true,
    stock_updated_at: '2026-08-21T12:00:00.000Z',
    product_updated_at: '2026-08-21T11:00:00.000Z',
  },
];

const exportedHeaders = [
  'export_schema_version',
  'product_id',
  'sku',
  'ean',
  'name',
  'category_id',
  'category',
  'product_type',
  'unit',
  'current_quantity',
  'minimum_quantity',
  'situation',
  'active',
  'stock_updated_at',
  'product_updated_at',
] as const;

function mappingFor(type: 'PRODUCTS' | 'STOCK_RECONCILIATION'): OperationalColumnMapping[] {
  const targets: Partial<
    Record<(typeof exportedHeaders)[number], OperationalColumnMapping['targetField']>
  > =
    type === 'PRODUCTS'
      ? {
          sku: 'sku',
          ean: 'ean',
          name: 'name',
          category: 'category',
          product_type: 'product_type',
          unit: 'unit',
          minimum_quantity: 'minimum_quantity',
        }
      : { sku: 'sku', ean: 'ean', current_quantity: 'current_quantity' };
  return exportedHeaders.map((sourceColumn) => ({
    sourceColumn,
    targetField: targets[sourceColumn] ?? 'IGNORE',
  }));
}

class TestEnvironmentRepository implements OperationalImportRepository {
  readonly staged: StageOperationalPreviewInput[] = [];

  stagePreview(input: StageOperationalPreviewInput) {
    this.staged.push(input);
    return Promise.resolve({
      batchId: `portable-${String(this.staged.length)}`,
      status: 'READY',
      summary: { ...emptySummary, TOTAL: input.rows.length, VALID: input.rows.length },
    });
  }

  getPreview(batchId: string, page: number, pageSize: number): Promise<OperationalPreviewPage> {
    const staged = this.staged.at(-1);
    if (!staged) throw new Error('Preview requested before staging');
    return Promise.resolve({
      batchId,
      importType: staged.importType,
      status: 'READY',
      summary: { ...emptySummary, TOTAL: staged.rows.length, VALID: staged.rows.length },
      rows: staged.rows.map((row) => ({
        rowNumber: row.rowNumber,
        rawData: row.rawData,
        normalizedData: row.normalizedData,
        state: 'VALID',
        action: 'NEW',
        issues: row.validationErrors,
      })),
      page,
      pageSize,
      totalRows: staged.rows.length,
    });
  }

  resolve() {
    return Promise.resolve(emptySummary);
  }

  confirm(options: { importType: OperationalImportType }) {
    return Promise.resolve({
      batchId: 'portable-confirmed',
      importType: options.importType,
      applied: true,
      created: 0,
      associated: 0,
      updated: 0,
      movementsCreated: 0,
      unchanged: 0,
      ignored: 0,
      warnings: 0,
      errors: 0,
    });
  }
}

function importFile(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  };
}

describe('Bloco 24 — portabilidade E2E', () => {
  it('exporta produtos + estoque e reimporta cadastro e saldo em fluxos separados', async () => {
    const definition = getExportDefinition('PRODUCTS_WITH_CURRENT_STOCK');
    const output = serializeExport('CSV', {
      definition,
      rows: portableRows,
      generatedAt: '2026-08-21T15:00:00.000Z',
    });
    const repository = new TestEnvironmentRepository();
    const file = importFile('produtos-com-estoque-atual_v1.csv', output.bytes);

    const products = await previewOperationalImport({
      file,
      importType: 'PRODUCTS',
      sourceName: 'Ambiente de teste — cadastro',
      mapping: mappingFor('PRODUCTS'),
      repository,
      parserOptions: { csv: { headerRowNumber: 6 } },
    });
    expect(products.rows).toHaveLength(2);
    expect(products.rows[0]?.normalizedData).toEqual({
      sku: 'PORT-001',
      ean: '7894900011517',
      name: 'Café torrado',
      category: 'Mercearia',
      product_type: 'RAW',
      unit: 'KG',
      minimum_quantity: '3.000',
    });
    expect(products.rows[0]?.normalizedData).not.toHaveProperty('current_quantity');

    const reconciliation = await previewOperationalImport({
      file,
      importType: 'STOCK_RECONCILIATION',
      sourceName: 'Ambiente de teste — reconciliação',
      mapping: mappingFor('STOCK_RECONCILIATION'),
      repository,
      parserOptions: { csv: { headerRowNumber: 6 } },
      allowDuplicateOfBatchId: products.batchId,
    });
    expect(reconciliation.rows.map(({ normalizedData }) => normalizedData)).toEqual([
      { sku: 'PORT-001', ean: '7894900011517', current_quantity: '12.500' },
      { sku: 'PORT-002', ean: null, current_quantity: '40.000' },
    ]);
  });

  it('gera XLSX que o próprio parser abre com schema e dados preservados', async () => {
    const definition = getExportDefinition('PRODUCTS_WITH_CURRENT_STOCK');
    const output = serializeExport('XLSX', {
      definition,
      rows: portableRows,
      generatedAt: '2026-08-21T15:00:00.000Z',
    });
    const repository = new TestEnvironmentRepository();
    const preview = await previewOperationalImport({
      file: importFile('produtos-com-estoque-atual_v1.xlsx', output.bytes),
      importType: 'PRODUCTS',
      sourceName: 'Ambiente de teste — XLSX',
      mapping: mappingFor('PRODUCTS'),
      repository,
      parserOptions: { xlsx: { worksheetName: 'Produtos e estoque' } },
    });
    expect(preview.rows).toHaveLength(2);
    expect(repository.staged[0]?.detectedHeaders).toEqual(exportedHeaders);
    expect(preview.rows[1]?.normalizedData).toMatchObject({
      sku: 'PORT-002',
      name: 'Guardanapo',
      product_type: 'FRACTIONATED',
      unit: 'UN',
    });
  });

  it('mantém UTF-8 no CSV e neutraliza fórmulas em CSV/XLSX', () => {
    const definition = getExportDefinition('PRODUCTS_WITH_CURRENT_STOCK');
    const dangerousRows = [{ ...portableRows[0], name: '=HYPERLINK("https://invalid.local")' }];
    const csv = serializeExport('CSV', {
      definition,
      rows: dangerousRows,
      generatedAt: '2026-08-21T15:00:00.000Z',
    });
    const csvText = new TextDecoder('utf-8', { fatal: true }).decode(csv.bytes);
    expect([...csv.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csvText).toContain('export_schema_version;1');
    expect(csvText).toContain("'=HYPERLINK");

    const xlsx = serializeExport('XLSX', {
      definition,
      rows: dangerousRows,
      generatedAt: '2026-08-21T15:00:00.000Z',
    });
    const worksheet = new TextDecoder().decode(unzipSync(xlsx.bytes)['xl/worksheets/sheet1.xml']);
    expect(worksheet).toContain('t="inlineStr"');
    expect(worksheet).toContain('=HYPERLINK');
    expect(worksheet).not.toContain('<f>');
  });
});
