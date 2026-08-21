import type { ExportCellValue } from '../domain/types';
import { dataHeaders, dataValues, metadataRows } from './document-rows';
import type { ExportDocumentInput, SerializedExport } from './types';

const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

function safeText(value: ExportCellValue): string {
  if (value === null) return '';
  const text = typeof value === 'boolean' ? String(value) : value;
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function csvCell(value: ExportCellValue): string {
  const text = safeText(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: readonly ExportCellValue[]): string {
  return values.map(csvCell).join(';');
}

export function formatCsv(input: ExportDocumentInput): SerializedExport {
  const lines = [
    ...metadataRows(input).slice(0, 4).map(csvRow),
    '',
    csvRow(dataHeaders(input)),
    ...input.rows.map((row) => csvRow(dataValues(input, row))),
  ];
  const content = `\uFEFF${lines.join('\r\n')}\r\n`;
  return {
    format: 'CSV',
    bytes: new TextEncoder().encode(content),
    mimeType: 'text/csv;charset=utf-8',
    extension: 'csv',
  };
}
