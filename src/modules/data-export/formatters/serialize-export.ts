import type { OperationalExportFormat } from '../domain/types';
import { formatCsv } from './csv-formatter';
import { formatJson } from './json-formatter';
import { formatPdf } from './pdf-formatter';
import type { ExportDocumentInput, SerializedExport } from './types';
import { formatXlsx } from './xlsx-formatter';

export function serializeExport(
  format: OperationalExportFormat,
  input: ExportDocumentInput,
): SerializedExport {
  if (format === 'CSV') return formatCsv(input);
  if (format === 'XLSX') return formatXlsx(input);
  if (format === 'JSON') return formatJson(input);
  return formatPdf(input);
}
