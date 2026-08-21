import { EXPORT_SCHEMA_VERSION, type ExportCellValue, type ExportRow } from '../domain/types';
import type { ExportDocumentInput } from './types';

export const VERSION_COLUMN_KEY = 'export_schema_version';

export function dataHeaders(input: ExportDocumentInput): readonly string[] {
  return [VERSION_COLUMN_KEY, ...input.definition.columns.map(({ key }) => key)];
}

export function dataValues(input: ExportDocumentInput, row: ExportRow): readonly ExportCellValue[] {
  return [
    String(EXPORT_SCHEMA_VERSION),
    ...input.definition.columns.map(({ key }) => row[key] ?? null),
  ];
}

export function metadataRows(input: ExportDocumentInput): readonly (readonly ExportCellValue[])[] {
  return [
    ['export_schema_version', String(EXPORT_SCHEMA_VERSION)],
    ['export_type', input.definition.type],
    ['generated_at', input.generatedAt],
    ['row_count', String(input.rows.length)],
    [],
    ['column_key', 'human_label', 'data_type'],
    [VERSION_COLUMN_KEY, 'Versão do schema de exportação', 'TEXT'],
    ...input.definition.columns.map(({ key, label, type }) => [key, label, type]),
  ];
}
