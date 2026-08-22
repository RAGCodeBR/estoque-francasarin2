import { describe, expect, it } from 'vitest';

import {
  analyzeLegacyMigrationFile,
  serializeLegacyAnalysisJson,
  serializeLegacyAnalysisMarkdown,
} from '../../../src/modules/data-import';
import { createCsvFile, createXlsxFile } from '../../fixtures/tabular-files';

describe('ensaio somente leitura da migração real', () => {
  it('analisa CSV, propõe mapeamentos e relata qualidade sem staging ou confirmação', async () => {
    const analysis = await analyzeLegacyMigrationFile({
      file: createCsvFile(
        [
          'COD;DESCRICAO;EAN;GRUPO;TIPO;UNIDADE;SALDO;MINIMO;PRECO_COMPRA',
          'A-001;Arroz;7894900011517;Mercearia;BRUTO;UNIDADE;10,5;2;12,00',
          'a-001; Arroz ;7894900011518;;FRACIONADO;KILO;-2;abc;13,00',
          'B-002;Feijão;;Mercearia;RAW;KG;0;1;8,00',
        ].join('\n'),
        'estoque-legado.csv',
      ),
      analyzedAt: '2026-08-21T18:00:00.000Z',
    });

    expect(analysis.file).toMatchObject({
      originalFilename: 'estoque-legado.csv',
      format: 'CSV',
    });
    expect(analysis.file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.availableSources).toEqual([{ name: 'CSV', position: 1 }]);
    const source = analysis.sources[0];
    expect(source).toMatchObject({
      name: 'CSV',
      status: 'ANALYZED',
      rowCount: 3,
      productTableCandidate: true,
    });
    expect(source?.summary).toMatchObject({
      totalProducts: 3,
      uniqueSkus: 2,
      productsWithoutCategory: 1,
      productsWithoutUnit: 0,
      unknownFields: ['PRECO_COMPRA'],
    });
    expect(source?.summary?.duplicateSkus).toEqual([
      { value: 'A-001', normalizedValue: 'A-001', rowNumbers: [2, 3] },
    ]);
    expect(source?.summary?.eans).toMatchObject({ informed: 2, unique: 2, valid: 1 });
    expect(source?.summary?.eans?.invalid).toEqual([{ rowNumber: 3, value: '7894900011518' }]);
    expect(source?.summary?.invalidQuantities).toEqual([
      { rowNumber: 3, field: 'minimum_quantity', value: 'abc', reason: 'INVALID' },
    ]);
    expect(source?.summary?.negativeQuantities).toEqual([
      { rowNumber: 3, field: 'opening_quantity', value: '-2', reason: 'NEGATIVE' },
    ]);
    expect(source?.summary?.duplicateProductCandidates).toEqual(
      expect.arrayContaining([{ reason: 'NORMALIZED_NAME', value: 'Arroz', rowNumbers: [2, 3] }]),
    );
    expect(source?.transformations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'unit', original: 'UNIDADE', destination: 'UN' }),
        expect.objectContaining({ field: 'unit', original: 'KILO', destination: 'KG' }),
        expect.objectContaining({ field: 'product_type', original: 'BRUTO', destination: 'RAW' }),
        expect.objectContaining({
          field: 'opening_quantity',
          original: '10,5',
          destination: '10.500',
        }),
      ]),
    );
    expect(analysis).toMatchObject({
      destructiveActionsExecuted: false,
      stagingExecuted: false,
      dryRunExecuted: false,
      confirmationPrepared: false,
    });

    const markdown = serializeLegacyAnalysisMarkdown(analysis);
    expect(markdown).toContain('Total de produtos/linhas candidatas | 3');
    expect(markdown).toContain('| UNIDADE | UN |');
    expect(markdown).toContain('Nenhuma escrita em staging.');
    expect(JSON.parse(serializeLegacyAnalysisJson(analysis))).toMatchObject({
      reportSchemaVersion: 1,
      mode: 'READ_ONLY_LEGACY_ANALYSIS',
    });
  });

  it('lista todas as planilhas e isola erro de fórmula sem executar conteúdo', async () => {
    const analysis = await analyzeLegacyMigrationFile({
      file: createXlsxFile(
        {
          Produtos: [
            ['COD', 'DESCRICAO', 'GRUPO', 'TIPO', 'UNIDADE'],
            ['P-1', 'Produto', 'Geral', 'BRUTO', 'UN'],
          ],
          Auxiliar: [['CAMPO'], [{ formula: '1+1', result: 2 }]],
          Vazia: [],
        },
        'legado-multiplas-planilhas.xlsx',
      ),
      analyzedAt: '2026-08-21T18:00:00.000Z',
    });

    expect(analysis.availableSources.map(({ name }) => name)).toEqual([
      'Produtos',
      'Auxiliar',
      'Vazia',
    ]);
    expect(analysis.sources.find(({ name }) => name === 'Produtos')).toMatchObject({
      status: 'ANALYZED',
      rowCount: 1,
      productTableCandidate: true,
    });
    expect(analysis.sources.find(({ name }) => name === 'Auxiliar')).toMatchObject({
      status: 'ERROR',
      findings: [expect.objectContaining({ code: 'FORMULA_NOT_ALLOWED', severity: 'ERROR' })],
    });
    expect(analysis.sources.find(({ name }) => name === 'Vazia')).toMatchObject({
      status: 'EMPTY',
    });
  });

  it('aceita ColumnMapping explicitamente confirmado para cabeçalhos desconhecidos', async () => {
    const analysis = await analyzeLegacyMigrationFile({
      file: createCsvFile('X1;X2;X3;X4;X5\n001;Sal;KG;Geral;BRUTO', 'cabecalhos-externos.csv'),
      analyzedAt: '2026-08-21T18:00:00.000Z',
      sourceConfigurations: {
        CSV: {
          columnMapping: [
            { sourceColumn: 'X1', targetField: 'sku' },
            { sourceColumn: 'X2', targetField: 'name' },
            { sourceColumn: 'X3', targetField: 'unit' },
            { sourceColumn: 'X4', targetField: 'category' },
            { sourceColumn: 'X5', targetField: 'product_type' },
          ],
        },
      },
    });

    expect(analysis.sources[0]).toMatchObject({
      productTableCandidate: true,
      columnMapping: [
        expect.objectContaining({ sourceColumn: 'X1', targetField: 'sku', status: 'CONFIRMED' }),
        expect.objectContaining({ sourceColumn: 'X2', targetField: 'name', status: 'CONFIRMED' }),
        expect.objectContaining({ sourceColumn: 'X3', targetField: 'unit', status: 'CONFIRMED' }),
        expect.objectContaining({
          sourceColumn: 'X4',
          targetField: 'category',
          status: 'CONFIRMED',
        }),
        expect.objectContaining({
          sourceColumn: 'X5',
          targetField: 'product_type',
          status: 'CONFIRMED',
        }),
      ],
    });
    expect(analysis.sources[0]?.summary).toMatchObject({ totalProducts: 1, uniqueSkus: 1 });
  });

  it('rejeita configuração que referencia planilha inexistente em vez de ignorá-la', async () => {
    await expect(
      analyzeLegacyMigrationFile({
        file: createXlsxFile({ Produtos: [['COD'], ['001']] }),
        sourceConfigurations: { ProdutoComErroDeDigitacao: { headerRowNumber: 1 } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_COLUMN_MAPPING' });
  });
});
