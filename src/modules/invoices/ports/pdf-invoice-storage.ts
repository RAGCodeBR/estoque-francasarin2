import type { PdfInvoiceFile } from '../domain/pdf-types';

export interface PdfInvoiceStorage {
  store(file: PdfInvoiceFile, fileHash: string): Promise<string>;
}
