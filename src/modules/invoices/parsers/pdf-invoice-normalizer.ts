import { isValidCnpj } from '../../../utils/cnpj';
import { isValidGtin } from '../../../utils/gtin';
import { isValidNfeAccessKey } from '../../../utils/nfe-access-key';
import type {
  ParsedPdfInvoice,
  PdfExtractedItem,
  PdfExtractionIssue,
  PdfTextExtraction,
  PdfTextLine,
} from '../domain/pdf-types';

function compact(value: string): string {
  return value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ');
}

function issue(
  code: string,
  field: string,
  problem: string,
  suggestion: string,
  source?: PdfTextLine,
): PdfExtractionIssue {
  return {
    code,
    field,
    problem,
    suggestion,
    page: source?.page ?? null,
    evidence: source?.text ?? null,
  };
}

function exactDecimal(value: string, scale: number): string | null {
  const compacted = compact(value).replaceAll(/\s/g, '');
  const normalized = compacted.includes(',')
    ? compacted.replaceAll('.', '').replace(',', '.')
    : compacted;
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,14})(?:\\.\\d{1,${String(scale)}})?$`);
  if (!pattern.test(normalized)) return null;
  const [integer = '0', fraction = ''] = normalized.split('.');
  return `${integer}.${fraction.padEnd(scale, '0')}`;
}

function findLabel(
  lines: readonly PdfTextLine[],
  pattern: RegExp,
): { readonly value: string; readonly source: PdfTextLine } | null {
  for (const line of lines) {
    const match = pattern.exec(compact(line.text));
    if (match?.[1]) return { value: compact(match[1]), source: line };
  }
  return null;
}

function findAccessKey(lines: readonly PdfTextLine[], issues: PdfExtractionIssue[]): string | null {
  const candidate = findLabel(lines, /CHAVE\s+DE\s+ACESSO\s*:?\s*([0-9 .-]{44,})/i);
  if (!candidate) return null;
  const digits = candidate.value.replaceAll(/\D/g, '');
  if (!isValidNfeAccessKey(digits)) {
    issues.push(
      issue(
        'INVALID_ACCESS_KEY',
        'accessKey',
        'A chave localizada não possui 44 dígitos válidos.',
        'Revise a chave de acesso.',
        candidate.source,
      ),
    );
    return null;
  }
  return digits;
}

function findSupplierDocument(
  lines: readonly PdfTextLine[],
  issues: PdfExtractionIssue[],
): string | null {
  const candidate = findLabel(
    lines,
    /(?:CNPJ\s+DO\s+EMITENTE|EMITENTE\s*[-:]?\s*CNPJ)\s*:?\s*([0-9./-]{14,18})/i,
  );
  if (!candidate) return null;
  const digits = candidate.value.replaceAll(/\D/g, '');
  if (!isValidCnpj(digits)) {
    issues.push(
      issue(
        'INVALID_SUPPLIER_DOCUMENT',
        'supplierDocument',
        'O CNPJ do emitente não é válido.',
        'Selecione ou informe o fornecedor correto.',
        candidate.source,
      ),
    );
    return null;
  }
  return digits;
}

function parseItemLine(line: PdfTextLine): PdfExtractedItem | null {
  const columns = line.text.split(/[|;]/).map(compact);
  if (columns.length !== 8 || !/^\d+$/.test(columns[0] ?? '')) return null;
  const lineNumber = Number(columns[0]);
  if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) return null;
  const eanText = (columns[3] ?? '').replaceAll(/\D/g, '');
  const ean = eanText && isValidGtin(eanText) ? eanText : null;
  const supplierProductCode = columns[1];
  const description = columns[2];
  const unit = columns[4];
  return {
    lineNumber,
    supplierProductCode:
      supplierProductCode === undefined || supplierProductCode === '' ? null : supplierProductCode,
    description: description === undefined || description === '' ? null : description,
    ean,
    unit: unit === undefined || unit === '' ? null : unit.toUpperCase(),
    quantity: exactDecimal(columns[5] ?? '', 3),
    unitPrice: exactDecimal(columns[6] ?? '', 4),
    totalAmount: exactDecimal(columns[7] ?? '', 2),
    page: line.page,
    rawText: line.text,
  };
}

export function normalizePdfInvoiceText(extraction: PdfTextExtraction): ParsedPdfInvoice {
  const lines = extraction.lines
    .map((line) => ({ ...line, text: compact(line.text) }))
    .filter(({ text }) => text !== '');
  const issues: PdfExtractionIssue[] = [];
  const accessKey = findAccessKey(lines, issues);
  const numberAndSeries = findLabel(
    lines,
    /(?:N[ÚU]MERO|N[º°O])\s*:?\s*(\d+)\s+(?:S[ÉE]RIE)\s*:?\s*(\d+)/i,
  );
  let invoiceNumber: string | null = null;
  let series: string | null = null;
  if (numberAndSeries) {
    const parsed = /(?:N[ÚU]MERO|N[º°O])\s*:?\s*(\d+)\s+(?:S[ÉE]RIE)\s*:?\s*(\d+)/i.exec(
      numberAndSeries.source.text,
    );
    invoiceNumber = parsed?.[1] ?? null;
    series = parsed?.[2] ?? null;
  }
  const issued = findLabel(
    lines,
    /DATA\s+(?:E\s+HORA\s+)?DE\s+EMISS[ÃA]O\s*:?\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?\s*[+-]\d{2}:?\d{2})?)/i,
  );
  let issuedAt: string | null = null;
  if (issued && /[+-]\d{2}:?\d{2}$/.test(issued.value)) {
    const match =
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}:?\d{2})$/.exec(
        issued.value,
      );
    if (match) {
      const day = match[1];
      const month = match[2];
      const year = match[3];
      const time = match[4];
      const rawOffset = match[5];
      if (day && month && year && time && rawOffset) {
        const offset = rawOffset.includes(':')
          ? rawOffset
          : `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`;
        const candidate = `${year}-${month}-${day}T${time}${offset}`;
        if (!Number.isNaN(Date.parse(candidate))) issuedAt = new Date(candidate).toISOString();
      }
    }
  }
  const supplierDocument = findSupplierDocument(lines, issues);
  const supplierName =
    findLabel(
      lines,
      /(?:RAZ[ÃA]O\s+SOCIAL\s+DO\s+EMITENTE|NOME\s*\/\s*RAZ[ÃA]O\s+SOCIAL\s+DO\s+EMITENTE)\s*:?\s*(.+)/i,
    )?.value ?? null;
  const items = lines.map(parseItemLine).filter((item): item is PdfExtractedItem => item !== null);

  const missing: readonly [string, string, string][] = [
    ['invoiceNumber', 'Número da nota não identificado.', 'Informe o número após conferir o PDF.'],
    [
      'issuedAt',
      'Data/hora com fuso não identificada.',
      'Informe a data e hora sem presumir valores ausentes.',
    ],
    [
      'supplierDocument',
      'CNPJ inequívoco do emitente não identificado.',
      'Selecione o fornecedor após conferir o emitente.',
    ],
  ];
  const values: Readonly<Record<string, unknown>> = { invoiceNumber, issuedAt, supplierDocument };
  for (const [field, problem, suggestion] of missing) {
    if (values[field] === null) issues.push(issue('MISSING_FIELD', field, problem, suggestion));
  }
  if (items.length === 0) {
    issues.push(
      issue(
        'NO_ITEMS_EXTRACTED',
        'items',
        'Nenhum item estruturado foi identificado.',
        'Revise o texto extraído e inclua os itens manualmente.',
      ),
    );
  }
  if (extraction.characterCount === 0) {
    issues.push(
      issue(
        'OCR_REQUIRED',
        'document',
        'O PDF não contém texto extraível.',
        'Use revisão manual ou um fluxo de OCR futuro.',
      ),
    );
  }

  return {
    accessKey,
    invoiceNumber,
    series,
    issuedAt,
    supplierDocument,
    supplierLegalName: supplierName,
    items,
    issues,
    extraction: { ...extraction, lines },
  };
}
