import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../../utils/domain-values';
import { isValidGtin } from '../../../utils/gtin';
import { isValidNfeAccessKey } from '../../../utils/nfe-access-key';
import type { PdfImportLimits } from '../config/pdf-limits';
import type { NfeConfirmationReport } from '../domain/types';
import type {
  PdfHeaderReview,
  PdfInvoiceFile,
  PdfInvoiceImportPreview,
  PdfItemReview,
} from '../domain/pdf-types';
import { parsePdfInvoiceFile } from '../parsers/pdf-invoice-parser';
import type { PdfInvoiceRepository } from '../ports/pdf-invoice-repository';
import type { PdfInvoiceStorage } from '../ports/pdf-invoice-storage';
import type { PdfTextExtractor } from '../ports/pdf-text-extractor';

function decimal(value: string, scale: number, field: string, positive: boolean): string {
  const normalized = value.trim();
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,14})(?:\\.\\d{1,${String(scale)}})?$`);
  if (!pattern.test(normalized))
    throw new Error(`${field} deve caber em NUMERIC(18,${String(scale)}).`);
  const [integer = '0', fraction = ''] = normalized.split('.');
  const result = `${integer}.${fraction.padEnd(scale, '0')}`;
  if (positive && /^0\.0+$/.test(result)) throw new Error(`${field} deve ser maior que zero.`);
  return result;
}

function normalizeHeader(header: PdfHeaderReview): PdfHeaderReview {
  const accessKey = normalizeOptionalText(header.accessKey);
  if (accessKey && !isValidNfeAccessKey(accessKey)) throw new Error('Chave de acesso inválida.');
  let issuedAt: string | undefined;
  if (header.issuedAt !== undefined) {
    const value = header.issuedAt.trim();
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) || Number.isNaN(Date.parse(value))) {
      throw new Error('Data de emissão deve incluir data, hora e fuso explícitos.');
    }
    issuedAt = new Date(value).toISOString();
  }
  return {
    ...(header.supplierId ? { supplierId: assertUuid(header.supplierId, 'ID do fornecedor') } : {}),
    ...(header.accessKey === undefined
      ? {}
      : { accessKey: normalizeOptionalText(header.accessKey) }),
    ...(header.invoiceNumber === undefined
      ? {}
      : { invoiceNumber: normalizeRequiredText(header.invoiceNumber, 'Número da nota') }),
    ...(header.series === undefined ? {} : { series: normalizeOptionalText(header.series) }),
    ...(issuedAt === undefined ? {} : { issuedAt }),
  };
}

function normalizeItem(item: PdfItemReview): PdfItemReview {
  const ean = normalizeOptionalText(item.ean);
  if (ean && !isValidGtin(ean)) throw new Error('EAN revisado inválido.');
  if (!Number.isInteger(item.lineNumber) || item.lineNumber <= 0)
    throw new Error('Número da linha deve ser um inteiro positivo.');
  return {
    ...(item.itemId ? { itemId: assertUuid(item.itemId, 'ID do item') } : {}),
    lineNumber: item.lineNumber,
    ...(item.ignored === undefined ? {} : { ignored: item.ignored }),
    ...(item.productId ? { productId: assertUuid(item.productId, 'ID do produto') } : {}),
    ...(item.supplierProductCode === undefined
      ? {}
      : { supplierProductCode: normalizeOptionalText(item.supplierProductCode) }),
    ...(item.description === undefined
      ? {}
      : { description: normalizeRequiredText(item.description, 'Descrição') }),
    ...(item.ean === undefined ? {} : { ean: normalizeOptionalText(item.ean) }),
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    ...(item.quantity === undefined
      ? {}
      : { quantity: decimal(item.quantity, 3, 'Quantidade', true) }),
    ...(item.unitPrice === undefined
      ? {}
      : { unitPrice: decimal(item.unitPrice, 4, 'Valor unitário', false) }),
    ...(item.totalAmount === undefined
      ? {}
      : { totalAmount: decimal(item.totalAmount, 2, 'Valor total', false) }),
    ...(item.createSupplierMapping === undefined
      ? {}
      : { createSupplierMapping: item.createSupplierMapping }),
  };
}

export class PdfInvoiceImportService {
  constructor(
    private readonly repository: PdfInvoiceRepository,
    private readonly storage?: PdfInvoiceStorage,
    private readonly extractor?: PdfTextExtractor,
  ) {}

  async upload(
    file: PdfInvoiceFile,
    originalFilePath?: string | null,
    limits?: PdfImportLimits,
  ): Promise<string> {
    const parsed = await parsePdfInvoiceFile(file, this.extractor, limits);
    const explicitPath = normalizeOptionalText(originalFilePath);
    const storedPath =
      explicitPath ?? (this.storage ? await this.storage.store(file, parsed.fileHash) : null);
    return this.repository.stage({ ...parsed, originalFilePath: storedPath });
  }

  getPreview(importId: string): Promise<PdfInvoiceImportPreview> {
    return this.repository.getPreview(assertUuid(importId, 'ID da importação PDF'));
  }

  review(
    importId: string,
    header: PdfHeaderReview,
    items: readonly PdfItemReview[],
  ): Promise<'PENDING_REVIEW' | 'READY'> {
    return this.repository.review(
      assertUuid(importId, 'ID da importação PDF'),
      normalizeHeader(header),
      items.map(normalizeItem),
    );
  }

  confirm(
    importId: string,
    destinationLocationId: string,
    idempotencyKey: string,
  ): Promise<NfeConfirmationReport> {
    return this.repository.confirm(
      assertUuid(importId, 'ID da importação PDF'),
      assertUuid(destinationLocationId, 'ID do local de estoque'),
      normalizeRequiredText(idempotencyKey, 'Chave de idempotência'),
    );
  }
}
