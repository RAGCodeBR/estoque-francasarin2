import { describe, expect, it } from 'vitest';

import {
  PdfInvoiceImportService,
  type NfeConfirmationReport,
  type PdfInvoiceImportPreview,
  type PdfInvoiceRepository,
  type PdfTextExtraction,
  type PdfTextExtractor,
  type StagePdfInvoiceInput,
} from '../../../src/modules/invoices';

function pdfFile() {
  const bytes = new TextEncoder().encode('%PDF-1.7\nfixture');
  return {
    name: 'nota.pdf',
    size: bytes.byteLength,
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

class FixedExtractor implements PdfTextExtractor {
  extract(): Promise<PdfTextExtraction> {
    return Promise.resolve({
      pageCount: 1,
      characterCount: 20,
      lines: [{ page: 1, text: 'NÚMERO: 10 SÉRIE: 1' }],
    });
  }
}

class MemoryRepository implements PdfInvoiceRepository {
  staged: StagePdfInvoiceInput | null = null;
  confirmations = 0;

  stage(input: StagePdfInvoiceInput): Promise<string> {
    this.staged = input;
    return Promise.resolve('11111111-1111-4111-8111-111111111111');
  }
  getPreview(): Promise<PdfInvoiceImportPreview> {
    return Promise.resolve({ import: {}, items: [] });
  }
  review(): Promise<'PENDING_REVIEW' | 'READY'> {
    return Promise.resolve('PENDING_REVIEW');
  }
  confirm(): Promise<NfeConfirmationReport> {
    this.confirmations += 1;
    return Promise.resolve({
      invoiceId: '22222222-2222-4222-8222-222222222222',
      itemsCreated: 1,
      movementsCreated: 1,
      supplierMappingsCreated: 0,
      applied: true,
    });
  }
}

describe('serviço assistido de PDF', () => {
  it('upload termina no staging e nunca chama confirmação ou estoque', async () => {
    const repository = new MemoryRepository();
    const service = new PdfInvoiceImportService(repository, undefined, new FixedExtractor());
    await expect(service.upload(pdfFile())).resolves.toBe('11111111-1111-4111-8111-111111111111');
    expect(repository.staged?.invoice).toMatchObject({
      invoiceNumber: '10',
      issuedAt: null,
      items: [],
    });
    expect(repository.confirmations).toBe(0);
  });

  it('não inventa fuso para data revisada e valida decimais exatos', () => {
    const service = new PdfInvoiceImportService(new MemoryRepository());
    expect(() =>
      service.review(
        '11111111-1111-4111-8111-111111111111',
        { issuedAt: '2026-08-20T10:00:00' },
        [],
      ),
    ).toThrow(/fuso explícitos/);
    expect(() =>
      service.review('11111111-1111-4111-8111-111111111111', {}, [
        { lineNumber: 1, quantity: '1.2345' },
      ]),
    ).toThrow(/NUMERIC\(18,3\)/);
  });
});
