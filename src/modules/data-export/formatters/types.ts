import type { ExportDefinition, ExportRow, OperationalExportFormat } from '../domain/types';

export interface ExportDocumentInput {
  readonly definition: ExportDefinition;
  readonly rows: readonly ExportRow[];
  readonly generatedAt: string;
}

export interface SerializedExport {
  readonly format: OperationalExportFormat;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: string;
}

export type ExportSerializer = (
  format: OperationalExportFormat,
  input: ExportDocumentInput,
) => Promise<SerializedExport>;
