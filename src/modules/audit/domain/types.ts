import type { PageRequest, PaginatedResult } from '../../../types/pagination';

export interface AuditLog {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly requestId: string | null;
  readonly oldData: Readonly<Record<string, unknown>> | null;
  readonly newData: Readonly<Record<string, unknown>> | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface AuditLogSearch extends PageRequest {
  readonly action?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly actorId?: string;
  readonly requestId?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
}

export type AuditLogPage = PaginatedResult<AuditLog>;

export type AdministrativeExportType =
  'PRODUCTS' | 'INVENTORY' | 'STOCK_MOVEMENTS' | 'AUDIT_LOGS' | 'IMPORT_REPORT';

export type AdministrativeExportFormat = 'CSV' | 'XLSX' | 'JSON';

export interface AdministrativeExportAuditInput {
  readonly exportType: AdministrativeExportType;
  readonly format: AdministrativeExportFormat;
  readonly rowCount: number;
  readonly idempotencyKey: string;
}

export interface AdministrativeExportAuditReport {
  readonly auditLogId: string;
  readonly exportId: string;
  readonly createdAt: string;
  readonly applied: boolean;
}
