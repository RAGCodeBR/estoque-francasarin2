import { describe, expect, it, vi } from 'vitest';

import {
  createOperationalImportTemplate,
  OperationalImportService,
  previewOperationalImport,
} from '../../../src/modules/data-import';
import { ImportFileError } from '../../../src/modules/data-import/domain/errors';
import { parseXlsx } from '../../../src/modules/data-import/parsers/xlsx-parser';
import type {
  OperationalImportRepository,
  OperationalPreviewSummary,
} from '../../../src/modules/data-import/domain/operational-types';
import { DEFAULT_IMPORT_LIMITS } from '../../../src/modules/data-import/config/import-limits';

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

function repository(): {
  repo: OperationalImportRepository;
  stagePreview: ReturnType<typeof vi.fn>;
} {
  const stagePreview = vi
    .fn()
    .mockResolvedValue({ batchId: 'batch-1', status: 'READY', summary: emptySummary });
  return {
    stagePreview,
    repo: {
      stagePreview,
      getPreview: vi.fn().mockResolvedValue({
        batchId: 'batch-1',
        importType: 'PRODUCTS',
        status: 'READY',
        summary: emptySummary,
        rows: [],
        page: 1,
        pageSize: 100,
        totalRows: 0,
      }),
      resolve: vi.fn().mockResolvedValue(emptySummary),
      confirm: vi.fn().mockResolvedValue({
        batchId: 'batch-1',
        importType: 'PRODUCTS',
        applied: true,
        created: 1,
        associated: 0,
        updated: 0,
        movementsCreated: 0,
        unchanged: 0,
        ignored: 0,
        warnings: 0,
        errors: 0,
      }),
    },
  };
}

describe('importação operacional', () => {
  it('gera o template oficial de produtos em CSV com cabeçalhos portáveis', () => {
    const template = createOperationalImportTemplate('PRODUCTS', 'CSV');
    expect([...template.bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    expect(new TextDecoder().decode(template.bytes)).toBe(
      'SKU;EAN;PRODUTO;CATEGORIA;TIPO;UNIDADE;QUANTIDADE_MINIMA\r\n',
    );
    expect(template.filename).toContain('products_v1.csv');
  });

  it('gera XLSX válido, sem fórmulas e com planilha de dados explícita', () => {
    const template = createOperationalImportTemplate('PRODUCTS', 'XLSX');
    const parsed = parseXlsx(template.bytes, DEFAULT_IMPORT_LIMITS, { worksheetName: 'Produtos' });
    expect(parsed.headers).toEqual([
      'SKU',
      'EAN',
      'PRODUTO',
      'CATEGORIA',
      'TIPO',
      'UNIDADE',
      'QUANTIDADE_MINIMA',
    ]);
    expect(parsed.rows).toEqual([]);
    expect(template.worksheetName).toBe('Produtos');
  });

  it('bloqueia QUANTIDADE_ATUAL no fluxo PRODUCTS antes do staging', async () => {
    const mocks = repository();
    const repo = mocks.repo;
    const content = new TextEncoder().encode(
      'SKU;PRODUTO;CATEGORIA;TIPO;UNIDADE;QUANTIDADE_MINIMA;QUANTIDADE_ATUAL\r\nA;Arroz;Secos;RAW;KG;1;10\r\n',
    );
    await expect(
      previewOperationalImport({
        file: {
          name: 'produtos.csv',
          size: content.byteLength,
          arrayBuffer: () => Promise.resolve(content.buffer),
        },
        importType: 'PRODUCTS',
        sourceName: 'Cadastro futuro',
        repository: repo,
        mapping: [
          { sourceColumn: 'SKU', targetField: 'sku' },
          { sourceColumn: 'PRODUTO', targetField: 'name' },
          { sourceColumn: 'CATEGORIA', targetField: 'category' },
          { sourceColumn: 'TIPO', targetField: 'product_type' },
          { sourceColumn: 'UNIDADE', targetField: 'unit' },
          { sourceColumn: 'QUANTIDADE_MINIMA', targetField: 'minimum_quantity' },
          { sourceColumn: 'QUANTIDADE_ATUAL', targetField: 'current_quantity' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_COLUMN_MAPPING' });
    expect(mocks.stagePreview).not.toHaveBeenCalled();
  });

  it('aceita cabeçalhos externos com mapeamento manual e normaliza quantidades', async () => {
    const mocks = repository();
    const repo = mocks.repo;
    const content = new TextEncoder().encode('COD;SALDO;IGNORAR\r\nA-1;12,5;x\r\n');
    await previewOperationalImport({
      file: {
        name: 'saldo.csv',
        size: content.byteLength,
        arrayBuffer: () => Promise.resolve(content.buffer),
      },
      importType: 'STOCK_RECONCILIATION',
      sourceName: 'Contagem externa',
      repository: repo,
      mapping: [
        { sourceColumn: 'COD', targetField: 'sku' },
        { sourceColumn: 'SALDO', targetField: 'current_quantity' },
        { sourceColumn: 'IGNORAR', targetField: 'IGNORE' },
      ],
    });
    expect(mocks.stagePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        importType: 'STOCK_RECONCILIATION',
        rows: [
          expect.objectContaining({ normalizedData: { sku: 'A-1', current_quantity: '12.500' } }),
        ],
      }),
    );
  });

  it('exige local e motivo canônico para confirmar reconciliação', () => {
    const service = new OperationalImportService(repository().repo);
    expect(() =>
      service.confirm({
        batchId: 'batch-1',
        importType: 'STOCK_RECONCILIATION',
        idempotencyKey: 'key',
        stockLocationId: 'location',
        reason: 'ajuste',
      }),
    ).toThrow(ImportFileError);
  });
});
