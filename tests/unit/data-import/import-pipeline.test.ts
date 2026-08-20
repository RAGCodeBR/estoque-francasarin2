import { describe, expect, it } from 'vitest';

import {
  ImportFileError,
  runImportDryRun,
  stageImportFile,
  type ColumnMapping,
  type CategoryLookup,
  type ImportStagingRepository,
  type ProductLookup,
} from '../../../src/modules/data-import';
import type {
  CreateStagedBatchInput,
  DuplicateImportBatch,
  SaveDryRunInput,
  StagedBatchData,
} from '../../../src/modules/data-import/ports/staging-repository';
import { createCsvFile, createImportFile, createXlsxFile } from '../../fixtures/tabular-files';

class MemoryStagingRepository implements ImportStagingRepository {
  private nextId = 1;
  readonly batches = new Map<string, { input: CreateStagedBatchInput; data: StagedBatchData }>();
  readonly dryRuns = new Map<string, SaveDryRunInput>();

  findOriginalByFileHash(fileHash: string): Promise<DuplicateImportBatch | null> {
    const found = [...this.batches.entries()].find(
      ([, batch]) =>
        batch.input.fileHash === fileHash && batch.input.duplicateOfBatchId === undefined,
    );
    return Promise.resolve(found ? { id: found[0], status: 'UPLOADED' } : null);
  }

  createBatchWithRows(
    input: CreateStagedBatchInput,
    rows: StagedBatchData['rows'],
  ): Promise<string> {
    const id = `batch-${String(this.nextId)}`;
    this.nextId += 1;
    this.batches.set(id, {
      input,
      data: { id, sourceName: input.sourceName, headers: input.detectedHeaders, rows },
    });
    return Promise.resolve(id);
  }

  loadBatch(batchId: string): Promise<StagedBatchData> {
    const batch = this.batches.get(batchId);
    return batch ? Promise.resolve(batch.data) : Promise.reject(new Error('Batch not found'));
  }

  saveDryRun(batchId: string, input: SaveDryRunInput): Promise<void> {
    this.dryRuns.set(batchId, input);
    return Promise.resolve();
  }
}

const mapping: readonly ColumnMapping[] = [
  { sourceColumn: 'COD', targetField: 'sku' },
  { sourceColumn: 'DESCRICAO', targetField: 'name' },
  { sourceColumn: 'SALDO_ATUAL', targetField: 'opening_quantity' },
  { sourceColumn: 'UNID', targetField: 'unit' },
  { sourceColumn: 'GRUPO', targetField: 'category' },
  { sourceColumn: 'TIPO', targetField: 'product_type' },
  { sourceColumn: 'PRECO_COMPRA', targetField: 'IGNORE' },
];

const categoryLookup: CategoryLookup = {
  findByNormalizedNames(names) {
    return Promise.resolve(names.map((name) => ({ id: `category-${name}`, name })));
  },
};

const emptyProductLookup: ProductLookup = {
  findIdentityMatches() {
    return Promise.resolve([]);
  },
  suggestBySimilarNames() {
    return Promise.resolve([]);
  },
};

describe('staging seguro de arquivos tabulares', () => {
  it('descobre cabeçalhos CSV sem assumir nomes e preserva dados somente no staging', async () => {
    const repository = new MemoryStagingRepository();
    const file = createCsvFile(
      [
        'COD;DESCRICAO;SALDO_ATUAL;UNID;GRUPO;TIPO;PRECO_COMPRA',
        '000157;Arroz;12,500;KG;Mercearia;MP;9,99',
        '000158;Feijão;;UN;Mercearia;RAW;8,50',
      ].join('\n'),
    );

    const result = await stageImportFile({
      file,
      sourceName: 'Sistema desconhecido',
      createdBy: 'user-1',
      repository,
    });

    expect(result).toMatchObject({
      batchId: 'batch-1',
      format: 'CSV',
      totalRows: 2,
      headers: ['COD', 'DESCRICAO', 'SALDO_ATUAL', 'UNID', 'GRUPO', 'TIPO', 'PRECO_COMPRA'],
    });
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.batches.get('batch-1')?.data.rows[0]?.rawData).toEqual({
      COD: '000157',
      DESCRICAO: 'Arroz',
      SALDO_ATUAL: '12,500',
      UNID: 'KG',
      GRUPO: 'Mercearia',
      TIPO: 'MP',
      PRECO_COMPRA: '9,99',
    });
  });

  it('bloqueia arquivo repetido e exige autorização rastreável para reprocessar', async () => {
    const repository = new MemoryStagingRepository();
    const file = createCsvFile('A\n1');
    const common = { file, sourceName: 'Legado', createdBy: 'user-1', repository } as const;

    const first = await stageImportFile(common);
    await expect(stageImportFile(common)).rejects.toMatchObject({ code: 'DUPLICATE_FILE' });

    const repeated = await stageImportFile({ ...common, allowDuplicateOfBatchId: first.batchId });
    expect(repository.batches.get(repeated.batchId)?.input.duplicateOfBatchId).toBe(first.batchId);
  });

  it('rejeita cabeçalhos duplicados, CSV malformado, fórmula e encoding inválido', async () => {
    const cases = [
      { file: createCsvFile('COD; cod \n1;2'), code: 'DUPLICATE_COLUMN' },
      { file: createCsvFile('COD;NOME\n1;"não fechado'), code: 'INVALID_CSV' },
      { file: createCsvFile('COD;NOME\n1;=1+1'), code: 'FORMULA_NOT_ALLOWED' },
      {
        file: createImportFile('dados.csv', new Uint8Array([0x43, 0x4f, 0x44, 0x0a, 0xc3, 0x28])),
        code: 'INVALID_ENCODING',
      },
    ];

    for (const testCase of cases) {
      await expect(
        stageImportFile({
          file: testCase.file,
          sourceName: 'Legado',
          createdBy: 'user-1',
          repository: new MemoryStagingRepository(),
        }),
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it('aplica limites configuráveis de arquivo, linhas, colunas e células', async () => {
    const repository = new MemoryStagingRepository();

    await expect(
      stageImportFile({
        file: createCsvFile('A\n12345'),
        sourceName: 'Legado',
        createdBy: 'user-1',
        repository,
        limits: { maxFileSizeBytes: 3 },
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    await expect(
      stageImportFile({
        file: createCsvFile('A\n1\n2'),
        sourceName: 'Legado',
        createdBy: 'user-1',
        repository,
        limits: { maxRows: 1 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    await expect(
      stageImportFile({
        file: createXlsxFile({ Produtos: [['A'], ['conteúdo repetido conteúdo repetido']] }),
        sourceName: 'Legado',
        createdBy: 'user-1',
        repository,
        limits: { maxXlsxCompressionRatio: 1 },
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_XLSX_CONTAINER' });
  });

  it('valida extensão, assinatura XLSX e permite encoding CSV selecionado explicitamente', async () => {
    const repository = new MemoryStagingRepository();

    await expect(
      stageImportFile({
        file: createCsvFile('A\n1', 'dados.xls'),
        sourceName: 'Legado',
        createdBy: 'user-1',
        repository,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });

    await expect(
      stageImportFile({
        file: createImportFile('dados.xlsx', new TextEncoder().encode('não é zip')),
        sourceName: 'Legado',
        createdBy: 'user-1',
        repository,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_XLSX' });

    const windows1252 = createImportFile(
      'dados.csv',
      new Uint8Array([
        0x43, 0x4f, 0x44, 0x3b, 0x4e, 0x4f, 0x4d, 0x45, 0x0a, 0x31, 0x3b, 0x63, 0x61, 0x66, 0xe9,
      ]),
    );
    const staged = await stageImportFile({
      file: windows1252,
      sourceName: 'Legado',
      createdBy: 'user-1',
      repository,
      parserOptions: { csv: { encoding: 'windows-1252' } },
    });
    expect(repository.batches.get(staged.batchId)?.data.rows[0]?.rawData.NOME).toBe('café');
  });

  it('lê XLSX sem executar células e exige seleção quando há múltiplas planilhas', async () => {
    const repository = new MemoryStagingRepository();
    const file = createXlsxFile({
      Produtos: [
        ['COD', 'DESCRICAO'],
        ['001', 'Arroz'],
      ],
    });

    const result = await stageImportFile({
      file,
      sourceName: 'Legado XLSX',
      createdBy: 'user-1',
      repository,
    });
    expect(result).toMatchObject({ format: 'XLSX', headers: ['COD', 'DESCRICAO'], totalRows: 1 });

    await expect(
      stageImportFile({
        file: createXlsxFile({
          A: [['COD'], ['1']],
          B: [['COD'], ['2']],
        }),
        sourceName: 'Legado XLSX',
        createdBy: 'user-1',
        repository: new MemoryStagingRepository(),
      }),
    ).rejects.toMatchObject({ code: 'MULTIPLE_WORKSHEETS' });

    await expect(
      stageImportFile({
        file: createXlsxFile({ Produtos: [['COD'], [{ formula: '1+1', result: 2 }]] }),
        sourceName: 'Legado XLSX',
        createdBy: 'user-1',
        repository: new MemoryStagingRepository(),
      }),
    ).rejects.toMatchObject({ code: 'FORMULA_NOT_ALLOWED' });
  });
});

describe('mapeamento, normalização e dry-run', () => {
  it('classifica TOTAL, VALID, INVALID, NEW, UPDATE_CANDIDATE, CONFLICT e IGNORED', async () => {
    const repository = new MemoryStagingRepository();
    const file = createCsvFile(
      [
        'COD;DESCRICAO;SALDO_ATUAL;UNID;GRUPO;TIPO;PRECO_COMPRA',
        '001;Arroz premium;10,500;kg;Mercearia;MP;1',
        '002;Feijão;;UN;Mercearia;RAW;2',
        '002;Feijão duplicado;1;UN;Mercearia;RAW;3',
        '003;;1;KG;Mercearia;RAW;4',
        ';;;;;;',
        '004;Sal;0;KG;Temperos;RAW;5',
        '005;Farinha;1.250;KG;Mercearia;RAW;6',
      ].join('\n'),
    );
    const staged = await stageImportFile({
      file,
      sourceName: 'Legado',
      createdBy: 'user-1',
      repository,
    });
    const productLookup: ProductLookup = {
      findIdentityMatches(queries) {
        const products = [
          {
            id: 'product-001',
            sku: '001',
            name: 'Arroz',
            unit: 'KG',
            category: 'Mercearia',
            productType: 'RAW',
          } as const,
          {
            id: 'product-004',
            sku: '004',
            name: 'Sal',
            unit: 'KG',
            category: 'Temperos',
            productType: 'RAW',
          } as const,
        ];
        return Promise.resolve(
          queries.flatMap((query) => {
            const product = products.find(({ sku }) => sku === query.sku);
            return product
              ? [{ rowNumber: query.rowNumber, matchedBy: 'SKU' as const, product }]
              : [];
          }),
        );
      },
      suggestBySimilarNames() {
        return Promise.resolve([]);
      },
    };

    const result = await runImportDryRun({
      batchId: staged.batchId,
      mapping,
      repository,
      productLookup,
      categoryLookup,
    });

    expect(result.summary).toEqual({
      TOTAL: 7,
      VALID: 2,
      INVALID: 1,
      NEW: 1,
      UPDATE_CANDIDATE: 1,
      CONFLICT: 2,
      IGNORED: 2,
    });
    expect(result.rows.find(({ rowNumber }) => rowNumber === 2)?.normalizedData).toMatchObject({
      sku: '001',
      opening_quantity: '10.500',
      unit: 'KG',
      product_type: 'RAW',
    });
    expect(repository.dryRuns.get(staged.batchId)?.summary).toEqual(result.summary);
  });

  it('resolve conflito por substituição de SKU sem gravar entidades oficiais', async () => {
    const repository = new MemoryStagingRepository();
    const staged = await stageImportFile({
      file: createCsvFile(
        [
          'COD;DESCRICAO;SALDO_ATUAL;UNID;GRUPO;TIPO;PRECO_COMPRA',
          '002;Feijão A;1;UN;Mercearia;RAW;2',
          '002;Feijão B;1;UN;Mercearia;RAW;3',
        ].join('\n'),
      ),
      sourceName: 'Legado',
      createdBy: 'user-1',
      repository,
    });
    const productLookup: ProductLookup = {
      findIdentityMatches() {
        return Promise.resolve([]);
      },
      suggestBySimilarNames() {
        return Promise.resolve([]);
      },
    };

    const result = await runImportDryRun({
      batchId: staged.batchId,
      mapping,
      repository,
      productLookup,
      categoryLookup,
      resolutions: [{ rowNumber: 3, decision: 'REPLACE_SKU', replacementSku: '002-B' }],
    });

    expect(result.summary).toMatchObject({ VALID: 2, NEW: 2, CONFLICT: 0 });
  });

  it('exige decisão explícita para todas as colunas, inclusive IGNORE', async () => {
    const repository = new MemoryStagingRepository();
    const staged = await stageImportFile({
      file: createCsvFile(
        'COD;DESCRICAO;SALDO_ATUAL;UNID;GRUPO;TIPO;PRECO_COMPRA\n1;A;0;UN;G;RAW;1',
      ),
      sourceName: 'Legado',
      createdBy: 'user-1',
      repository,
    });

    await expect(
      runImportDryRun({
        batchId: staged.batchId,
        mapping: mapping.filter(({ sourceColumn }) => sourceColumn !== 'PRECO_COMPRA'),
        repository,
        productLookup: emptyProductLookup,
        categoryLookup,
      }),
    ).rejects.toBeInstanceOf(ImportFileError);
  });

  it('marca valores e precisão inesperados como inválidos sem coerção silenciosa', async () => {
    const repository = new MemoryStagingRepository();
    const staged = await stageImportFile({
      file: createCsvFile(
        'COD;DESCRICAO;SALDO_ATUAL;UNID;GRUPO;TIPO;PRECO_COMPRA\n1;Item;1,2345;L;G;DESCONHECIDO;0',
      ),
      sourceName: 'Legado',
      createdBy: 'user-1',
      repository,
    });

    const result = await runImportDryRun({
      batchId: staged.batchId,
      mapping,
      repository,
      productLookup: emptyProductLookup,
      categoryLookup,
    });

    expect(result.summary).toMatchObject({ TOTAL: 1, VALID: 0, INVALID: 1 });
    expect(result.rows[0]?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['QUANTITY_SCALE', 'UNEXPECTED_VALUE']),
    );
  });
});
