import { describe, expect, it } from 'vitest';

import {
  PdfImportError,
  parsePdfInvoiceFile,
  type PdfTextExtraction,
  type PdfTextExtractor,
} from '../../../src/modules/invoices';
import { VALID_ACCESS_KEY } from '../../fixtures/nfe-xml';

function pdfFile(content = '%PDF-1.7\nfixture') {
  const bytes = new TextEncoder().encode(content);
  return {
    name: 'nota.pdf',
    size: bytes.byteLength,
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

class FixedTextExtractor implements PdfTextExtractor {
  constructor(private readonly extraction: PdfTextExtraction) {}
  extract(): Promise<PdfTextExtraction> {
    return Promise.resolve(this.extraction);
  }
}

function extraction(lines: readonly string[]): PdfTextExtraction {
  return {
    pageCount: 1,
    lines: lines.map((text) => ({ text, page: 1 })),
    characterCount: lines.reduce((total, line) => total + line.length, 0),
  };
}

describe('importação assistida de PDF', () => {
  it('extrai somente campos inequívocos e preserva evidência por página', async () => {
    const result = await parsePdfInvoiceFile(
      pdfFile(),
      new FixedTextExtractor(
        extraction([
          `CHAVE DE ACESSO: ${VALID_ACCESS_KEY}`,
          'NÚMERO: 123 SÉRIE: 1',
          'DATA E HORA DE EMISSÃO: 20/08/2026 10:15:00 -03:00',
          'CNPJ DO EMITENTE: 11.222.333/0001-81',
          'RAZÃO SOCIAL DO EMITENTE: Fornecedor Teste Ltda',
          '1 | COD-1 | Arroz Integral | 7894900011517 | KG | 5,250 | 10,5000 | 55,13',
        ]),
      ),
    );

    expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.invoice).toMatchObject({
      accessKey: VALID_ACCESS_KEY,
      invoiceNumber: '123',
      series: '1',
      issuedAt: '2026-08-20T13:15:00.000Z',
      supplierDocument: '11222333000181',
      supplierLegalName: 'Fornecedor Teste Ltda',
      issues: [],
    });
    expect(result.invoice.items).toEqual([
      {
        lineNumber: 1,
        supplierProductCode: 'COD-1',
        description: 'Arroz Integral',
        ean: '7894900011517',
        unit: 'KG',
        quantity: '5.250',
        unitPrice: '10.5000',
        totalAmount: '55.13',
        page: 1,
        rawText: '1 | COD-1 | Arroz Integral | 7894900011517 | KG | 5,250 | 10,5000 | 55,13',
      },
    ]);
    expect(result.invoice.extraction.lines[0]).toMatchObject({ page: 1 });
  });

  it('mantém leitura parcial em revisão e não inventa campos ausentes', async () => {
    const result = await parsePdfInvoiceFile(
      pdfFile(),
      new FixedTextExtractor(extraction(['NÚMERO: 456 SÉRIE: 2', 'Texto parcial sem tabela'])),
    );

    expect(result.invoice).toMatchObject({
      invoiceNumber: '456',
      series: '2',
      issuedAt: null,
      supplierDocument: null,
      supplierLegalName: null,
      items: [],
    });
    expect(result.invoice.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['MISSING_FIELD', 'NO_ITEMS_EXTRACTED']),
    );
  });

  it('marca PDF sem camada de texto como candidato a revisão/OCR, sem fabricar conteúdo', async () => {
    const result = await parsePdfInvoiceFile(pdfFile(), new FixedTextExtractor(extraction([])));
    expect(result.invoice.items).toEqual([]);
    expect(result.invoice.issues.map(({ code }) => code)).toContain('OCR_REQUIRED');
  });

  it('rejeita assinatura, extensão, tamanho e PDF estruturalmente inválidos', async () => {
    await expect(
      parsePdfInvoiceFile(
        { ...pdfFile('arquivo qualquer'), name: 'nota.pdf' },
        new FixedTextExtractor(extraction([])),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PDF' });
    await expect(
      parsePdfInvoiceFile(
        { ...pdfFile(), name: 'nota.xml' },
        new FixedTextExtractor(extraction([])),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCUMENT' });
    await expect(
      parsePdfInvoiceFile(pdfFile(), new FixedTextExtractor(extraction([])), {
        maxFileBytes: 2,
        maxPages: 10,
        maxExtractedCharacters: 100,
        maxItems: 10,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(parsePdfInvoiceFile(pdfFile('%PDF-1.7\nbroken'))).rejects.toBeInstanceOf(
      PdfImportError,
    );
  });
});
