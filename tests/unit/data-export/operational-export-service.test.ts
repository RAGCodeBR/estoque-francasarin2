import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  OperationalExportService,
  serializeExport,
  type ExportAuditInput,
  type ExportAuditReceipt,
  type ExportDataPage,
  type ExportPageRequest,
  type ExportRow,
  type OperationalExportRepository,
  type OperationalExportRequest,
} from '../../../src/modules/data-export';
import { getExportDefinition } from '../../../src/modules/data-export/domain/export-definitions';
import { parseXlsx } from '../../../src/modules/data-import/parsers/xlsx-parser';
import { DEFAULT_IMPORT_LIMITS } from '../../../src/modules/data-import';

const ids = {
  product: 'd1000000-0000-4000-8000-000000000001',
  category: 'd1000000-0000-4000-8000-000000000002',
} as const;

const productRows: readonly ExportRow[] = [
  {
    product_id: ids.product,
    sku: 'ARR-001',
    ean: '7891234567895',
    name: 'Arroz agulhinha',
    category_id: ids.category,
    category: 'Mercearia',
    product_type: 'RAW',
    unit: 'KG',
    minimum_quantity: '5.000',
    active: true,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T11:00:00Z',
  },
  {
    product_id: 'd1000000-0000-4000-8000-000000000003',
    sku: 'CAF-001',
    ean: null,
    name: 'Café torrado',
    category_id: ids.category,
    category: 'Mercearia',
    product_type: 'RAW',
    unit: 'KG',
    minimum_quantity: '2.500',
    active: true,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T11:00:00Z',
  },
  {
    product_id: 'd1000000-0000-4000-8000-000000000004',
    sku: 'OLD-001',
    ean: null,
    name: 'Produto antigo',
    category_id: ids.category,
    category: 'Mercearia',
    product_type: 'RAW',
    unit: 'UN',
    minimum_quantity: '0.000',
    active: false,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T11:00:00Z',
  },
];

class ExportRepositoryStub implements OperationalExportRepository {
  readonly requests: ExportPageRequest[] = [];
  readonly audits: ExportAuditInput[] = [];
  rows: readonly ExportRow[] = productRows;
  totalOverride: number | undefined;

  async fetchPage(request: ExportPageRequest): Promise<ExportDataPage> {
    this.requests.push(request);
    const start = (request.page - 1) * request.pageSize;
    return Promise.resolve({
      schemaVersion: 1,
      exportType: request.type,
      page: request.page,
      pageSize: request.pageSize,
      total: this.totalOverride ?? this.rows.length,
      rows: this.rows.slice(start, start + request.pageSize),
    });
  }

  async recordCompletion(input: ExportAuditInput): Promise<ExportAuditReceipt> {
    this.audits.push(input);
    return Promise.resolve({
      auditLogId: 'd2000000-0000-4000-8000-000000000001',
      exportId: 'd2000000-0000-4000-8000-000000000002',
      createdAt: '2026-08-20T15:00:00.000Z',
      applied: true,
    });
  }
}

describe('OperationalExportService', () => {
  it('busca todas as páginas, normaliza filtros/seleção e audita somente após gerar', async () => {
    const repository = new ExportRepositoryStub();
    const service = new OperationalExportService(repository, {
      limits: { pageSize: 2 },
      now: () => new Date('2026-08-20T15:30:45.000Z'),
    });
    const artifact = await service.export({
      type: 'PRODUCTS',
      format: 'CSV',
      filters: {
        search: '  café   torrado ',
        categoryId: ids.category.toUpperCase(),
        isActive: true,
      },
      selectedIds: [ids.product.toUpperCase(), ids.product],
      idempotencyKey: ' export:products:1 ',
    });

    expect(repository.requests).toHaveLength(2);
    expect(repository.requests[0]).toEqual({
      type: 'PRODUCTS',
      filters: { search: 'café torrado', categoryId: ids.category, isActive: true },
      selectedIds: [ids.product],
      page: 1,
      pageSize: 2,
    });
    expect(repository.requests[1]).toMatchObject({ page: 2 });
    expect(repository.audits).toEqual([
      {
        exportType: 'PRODUCTS',
        format: 'CSV',
        rowCount: 3,
        idempotencyKey: 'export:products:1',
      },
    ]);
    expect(artifact).toMatchObject({
      fileName: 'estoque-produtos-20260820T153045Z.csv',
      mimeType: 'text/csv;charset=utf-8',
      schemaVersion: 1,
      rowCount: 3,
    });
  });

  it('interrompe sem auditar quando schema, linha ou limite são inválidos', async () => {
    const unexpected = new ExportRepositoryStub();
    unexpected.rows = [{ ...productRows[0], token: 'não pode sair' }];
    const service = new OperationalExportService(unexpected);
    await expect(
      service.export({
        type: 'PRODUCTS',
        format: 'JSON',
        idempotencyKey: 'export:unsafe',
      }),
    ).rejects.toThrow(/sensível proibido|inesperado/);
    expect(unexpected.audits).toEqual([]);

    const excessive = new ExportRepositoryStub();
    excessive.totalOverride = 101;
    await expect(
      new OperationalExportService(excessive, { limits: { maxRows: 100 } }).export({
        type: 'PRODUCTS',
        format: 'CSV',
        idempotencyKey: 'export:large',
      }),
    ).rejects.toThrow(/limite de 100 registros/);
    expect(excessive.audits).toEqual([]);
  });

  it('rejeita tipo, formato, filtros, datas, UUIDs e seleção inválidos antes da consulta', async () => {
    const repository = new ExportRepositoryStub();
    const service = new OperationalExportService(repository);
    await expect(
      service.export({
        type: 'PRODUCTS',
        format: 'CSV',
        filters: { movementType: 'LOSS' },
        idempotencyKey: 'bad-filter',
      }),
    ).rejects.toThrow(/não é permitido/);
    await expect(
      service.export({
        type: 'LOSSES',
        format: 'CSV',
        filters: {
          createdFrom: '2026-08-21T00:00:00Z',
          createdTo: '2026-08-20T00:00:00Z',
        },
        idempotencyKey: 'bad-date',
      }),
    ).rejects.toThrow(/não pode ser posterior/);
    await expect(
      service.export({
        type: 'PRODUCTS',
        format: 'CSV',
        selectedIds: ['inválido'],
        idempotencyKey: 'bad-id',
      }),
    ).rejects.toThrow(/UUID válido/);
    await expect(
      service.export({
        type: 'INVALID',
        format: 'CSV',
        idempotencyKey: 'bad-type',
      } as unknown as OperationalExportRequest),
    ).rejects.toThrow(/Tipo de exportação/);
    expect(repository.requests).toEqual([]);
  });
});

describe('formatadores operacionais', () => {
  const generatedAt = '2026-08-20T15:30:45.000Z';
  const definition = getExportDefinition('PRODUCTS');

  it('gera CSV UTF-8 com BOM, ponto e vírgula, schema e proteção contra fórmulas', () => {
    const dangerous = { ...productRows[0], name: '=HYPERLINK("https://example.invalid";"Café")' };
    const output = serializeExport('CSV', { definition, rows: [dangerous], generatedAt });
    const text = new TextDecoder().decode(output.bytes);
    expect([...output.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain('export_schema_version;1');
    expect(text).toContain('export_schema_version;product_id;sku;ean;name;');
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain('Café');
    expect(text).toContain('\r\n');
  });

  it('gera XLSX OpenXML legível, com Dados/Metadados e nenhuma fórmula', () => {
    const output = serializeExport('XLSX', {
      definition,
      rows: productRows.slice(0, 2),
      generatedAt,
    });
    const entries = unzipSync(output.bytes);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ]),
    );
    const workbook = new TextDecoder().decode(entries['xl/workbook.xml']);
    const dataXml = new TextDecoder().decode(entries['xl/worksheets/sheet1.xml']);
    const metadataXml = new TextDecoder().decode(entries['xl/worksheets/sheet2.xml']);
    expect(workbook).toContain('name="Produtos"');
    expect(workbook).toContain('name="Metadados"');
    expect(dataXml).toContain('<autoFilter');
    expect(dataXml).toContain('state="frozen"');
    expect(dataXml).not.toContain('<f>');
    expect(metadataXml).toContain('export_schema_version');

    const parsed = parseXlsx(output.bytes, DEFAULT_IMPORT_LIMITS, { worksheetName: 'Produtos' });
    expect(parsed.headers).toContain('export_schema_version');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]?.rawData).toMatchObject({ name: 'Café torrado', sku: 'CAF-001' });
  });

  it('gera JSON técnico autocontido com schema, colunas e linhas versionadas', () => {
    const firstProduct = productRows[0];
    if (!firstProduct) throw new Error('Fixture de produto ausente.');
    const output = serializeExport('JSON', { definition, rows: [firstProduct], generatedAt });
    const document = JSON.parse(new TextDecoder().decode(output.bytes)) as Record<string, unknown>;
    expect(document).toMatchObject({
      export_schema_version: 1,
      export_type: 'PRODUCTS',
      row_count: 1,
    });
    expect(document.rows).toEqual([
      expect.objectContaining({
        export_schema_version: 1,
        sku: 'ARR-001',
        name: 'Arroz agulhinha',
      }),
    ]);
  });

  it('mantém texto parecido com fórmula como inline string no XLSX', () => {
    const dangerous = { ...productRows[0], name: '=1+1' };
    const output = serializeExport('XLSX', { definition, rows: [dangerous], generatedAt });
    const xml = new TextDecoder().decode(unzipSync(output.bytes)['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain('=1+1');
    expect(xml).not.toContain('<f>');
  });
});
