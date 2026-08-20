import { calculateSha256 } from '../../data-import/infrastructure/file-hash';
import type { PdfImportLimits } from '../config/pdf-limits';
import { DEFAULT_PDF_IMPORT_LIMITS } from '../config/pdf-limits';
import { PdfImportError } from '../domain/pdf-errors';
import type { ParsedPdfInvoiceFile, PdfInvoiceFile } from '../domain/pdf-types';
import { PdfJsTextExtractor } from '../infrastructure/pdfjs-text-extractor';
import type { PdfTextExtractor } from '../ports/pdf-text-extractor';
import { normalizePdfInvoiceText } from './pdf-invoice-normalizer';

export async function parsePdfInvoiceFile(
  file: PdfInvoiceFile,
  extractor: PdfTextExtractor = new PdfJsTextExtractor(),
  limits: PdfImportLimits = DEFAULT_PDF_IMPORT_LIMITS,
): Promise<ParsedPdfInvoiceFile> {
  if (file.size <= 0 || file.size > limits.maxFileBytes) {
    throw new PdfImportError('FILE_TOO_LARGE', 'O PDF está vazio ou excede o limite configurado.', {
      maxFileBytes: limits.maxFileBytes,
    });
  }
  const filename = file.name.normalize('NFKC').trim();
  if (!filename.toLowerCase().endsWith('.pdf'))
    throw new PdfImportError(
      'UNSUPPORTED_DOCUMENT',
      'Somente arquivos PDF são aceitos neste fluxo.',
    );
  if (filename.length > 255)
    throw new PdfImportError('INVALID_PDF', 'O nome do arquivo PDF excede 255 caracteres.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size)
    throw new PdfImportError('INVALID_PDF', 'O tamanho lido não corresponde ao arquivo informado.');
  const signatureWindow = new TextDecoder('ascii').decode(
    bytes.subarray(0, Math.min(1024, bytes.length)),
  );
  if (!signatureWindow.includes('%PDF-'))
    throw new PdfImportError('INVALID_PDF', 'A assinatura do arquivo PDF é inválida.');
  const extraction = await extractor.extract(bytes, limits);
  if (extraction.pageCount <= 0 || extraction.pageCount > limits.maxPages)
    throw new PdfImportError('INVALID_PDF', 'Quantidade de páginas inválida.');
  const invoice = normalizePdfInvoiceText(extraction);
  if (invoice.items.length > limits.maxItems)
    throw new PdfImportError('INVALID_PDF', 'A extração excede o limite de itens.', {
      maxItems: limits.maxItems,
    });
  return { fileHash: await calculateSha256(bytes), originalFilename: filename, invoice };
}
