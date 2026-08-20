import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../../utils/domain-values';
import { resolvePageRequest } from '../../../types/pagination';
import type {
  AdministrativeExportAuditInput,
  AdministrativeExportAuditReport,
  AuditLogPage,
  AuditLogSearch,
} from '../domain/types';
import type { AuditRepository } from '../ports/audit-repository';

function normalizeTimestamp(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} deve conter data, hora e fuso explícitos.`);
  }
  return new Date(normalized).toISOString();
}

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async search(query: AuditLogSearch = {}): Promise<AuditLogPage> {
    const page = resolvePageRequest(query);
    const createdFrom = normalizeTimestamp(query.createdFrom, 'Data inicial');
    const createdTo = normalizeTimestamp(query.createdTo, 'Data final');
    const action = normalizeOptionalText(query.action);
    const entityType = normalizeOptionalText(query.entityType);
    const entityId = normalizeOptionalText(query.entityId);
    if (createdFrom && createdTo && createdFrom > createdTo) {
      throw new Error('Data inicial não pode ser posterior à data final.');
    }

    return await this.repository.search({
      ...page,
      ...(action === null ? {} : { action }),
      ...(entityType === null ? {} : { entityType }),
      ...(entityId === null ? {} : { entityId }),
      ...(query.actorId === undefined
        ? {}
        : { actorId: assertUuid(query.actorId, 'ID do usuário') }),
      ...(query.requestId === undefined
        ? {}
        : { requestId: assertUuid(query.requestId, 'ID da requisição') }),
      ...(createdFrom === undefined ? {} : { createdFrom }),
      ...(createdTo === undefined ? {} : { createdTo }),
    });
  }

  async recordAdministrativeExport(
    input: AdministrativeExportAuditInput,
  ): Promise<AdministrativeExportAuditReport> {
    if (!Number.isSafeInteger(input.rowCount) || input.rowCount < 0) {
      throw new Error('Quantidade de linhas exportadas deve ser um inteiro não negativo.');
    }
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, 'Chave de idempotência');
    if (idempotencyKey.length > 200) {
      throw new Error('Chave de idempotência deve possuir no máximo 200 caracteres.');
    }
    return await this.repository.recordAdministrativeExport({ ...input, idempotencyKey });
  }
}
