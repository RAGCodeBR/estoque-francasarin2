import { EXPORT_SCHEMA_VERSION } from '../domain/types';
import { VERSION_COLUMN_KEY } from './document-rows';
import type { ExportDocumentInput, SerializedExport } from './types';

export function formatJson(input: ExportDocumentInput): SerializedExport {
  const document = {
    export_schema_version: EXPORT_SCHEMA_VERSION,
    export_type: input.definition.type,
    generated_at: input.generatedAt,
    row_count: input.rows.length,
    columns: [
      { key: VERSION_COLUMN_KEY, label: 'Versão do schema de exportação', type: 'TEXT' },
      ...input.definition.columns,
    ],
    rows: input.rows.map((row) => ({
      [VERSION_COLUMN_KEY]: EXPORT_SCHEMA_VERSION,
      ...row,
    })),
  };
  return {
    format: 'JSON',
    bytes: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
    mimeType: 'application/json;charset=utf-8',
    extension: 'json',
  };
}
