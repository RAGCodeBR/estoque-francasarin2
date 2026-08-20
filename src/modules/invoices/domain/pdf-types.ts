import type { NfeXmlFile } from './types';

export type PdfInvoiceFile = NfeXmlFile;

export interface PdfTextLine {
  readonly text: string;
  readonly page: number;
}

export interface PdfTextExtraction {
  readonly pageCount: number;
  readonly lines: readonly PdfTextLine[];
  readonly characterCount: number;
}

export interface PdfExtractionIssue {
  readonly code: string;
  readonly field: string;
  readonly problem: string;
  readonly suggestion: string;
  readonly page: number | null;
  readonly evidence: string | null;
}

export interface PdfExtractedItem {
  readonly lineNumber: number;
  readonly supplierProductCode: string | null;
  readonly description: string | null;
  readonly ean: string | null;
  readonly unit: string | null;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly totalAmount: string | null;
  readonly page: number;
  readonly rawText: string;
}

export interface ParsedPdfInvoice {
  readonly accessKey: string | null;
  readonly invoiceNumber: string | null;
  readonly series: string | null;
  readonly issuedAt: string | null;
  readonly supplierDocument: string | null;
  readonly supplierLegalName: string | null;
  readonly items: readonly PdfExtractedItem[];
  readonly issues: readonly PdfExtractionIssue[];
  readonly extraction: PdfTextExtraction;
}

export interface ParsedPdfInvoiceFile {
  readonly fileHash: string;
  readonly originalFilename: string;
  readonly invoice: ParsedPdfInvoice;
}

export interface PdfItemReview {
  readonly itemId?: string;
  readonly lineNumber: number;
  readonly ignored?: boolean;
  readonly productId?: string;
  readonly supplierProductCode?: string | null;
  readonly description?: string;
  readonly ean?: string | null;
  readonly unit?: 'UN' | 'KG';
  readonly quantity?: string;
  readonly unitPrice?: string;
  readonly totalAmount?: string;
  readonly createSupplierMapping?: boolean;
}

export interface PdfHeaderReview {
  readonly supplierId?: string;
  readonly accessKey?: string | null;
  readonly invoiceNumber?: string;
  readonly series?: string | null;
  readonly issuedAt?: string;
}

export interface PdfInvoiceImportPreview {
  readonly import: Readonly<Record<string, unknown>>;
  readonly items: readonly Readonly<Record<string, unknown>>[];
}
