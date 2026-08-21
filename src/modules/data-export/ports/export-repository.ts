import type {
  ExportAuditInput,
  ExportAuditReceipt,
  ExportDataPage,
  ExportPageRequest,
} from '../domain/types';

export interface OperationalExportRepository {
  fetchPage(request: ExportPageRequest): Promise<ExportDataPage>;
  recordCompletion(input: ExportAuditInput): Promise<ExportAuditReceipt>;
}
