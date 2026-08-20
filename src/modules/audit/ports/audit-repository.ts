import type {
  AdministrativeExportAuditInput,
  AdministrativeExportAuditReport,
  AuditLogPage,
  AuditLogSearch,
} from '../domain/types';

export interface AuditRepository {
  search(query: AuditLogSearch): Promise<AuditLogPage>;
  recordAdministrativeExport(
    input: AdministrativeExportAuditInput,
  ): Promise<AdministrativeExportAuditReport>;
}
