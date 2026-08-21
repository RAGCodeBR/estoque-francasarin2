import { describe, expect, it } from 'vitest';

import {
  inspectProductImportFile,
  prepareProductImport,
  type ColumnMapping,
} from '../../../src/modules/data-import';
import { createCsvFile } from '../../fixtures/tabular-files';

const mapping: readonly ColumnMapping[] = [
  { sourceColumn: 'CODIGO', targetField: 'sku' },
  { sourceColumn: 'PRODUTO', targetField: 'name' },
  { sourceColumn: 'CATEGORIA', targetField: 'category' },
  { sourceColumn: 'TIPO', targetField: 'product_type' },
  { sourceColumn: 'UNIDADE', targetField: 'unit' },
  { sourceColumn: 'MINIMO', targetField: 'minimum_quantity' },
];

describe('importação tabular em escala', () => {
  it('analisa e normaliza 10.000 linhas sem carregar elementos React por linha', async () => {
    const lines = ['CODIGO;PRODUTO;CATEGORIA;TIPO;UNIDADE;MINIMO'];
    for (let index = 1; index <= 10_000; index += 1) {
      const suffix = String(index).padStart(5, '0');
      lines.push(`ESC-${suffix};Produto ${suffix};Categoria ${String(index % 20)};RAW;KG;5,000`);
    }
    const startedAt = performance.now();
    const inspection = await inspectProductImportFile({
      file: createCsvFile(lines.join('\n'), 'escala-10000.csv'),
    });
    const prepared = prepareProductImport({
      mode: 'MASTER_DATA_IMPORT',
      inspection,
      mapping,
    });
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(inspection.rows).toHaveLength(10_000);
    expect(inspection.sampleRows).toHaveLength(5);
    expect(prepared.summary).toEqual({
      total: 10_000,
      valid: 10_000,
      warnings: 0,
      errors: 0,
      conflicts: 0,
      ignored: 0,
    });
    expect(prepared.rows[9_999]?.normalizedData).toMatchObject({
      sku: 'ESC-10000',
      name: 'Produto 10000',
      minimum_quantity: '5.000',
    });
    expect(elapsedMilliseconds).toBeLessThan(10_000);
  }, 15_000);
});
