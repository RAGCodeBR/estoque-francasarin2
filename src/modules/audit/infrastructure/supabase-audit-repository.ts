import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  nullableString,
  parsePagePayload,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import { createPaginatedResult } from '../../../types/pagination';
import type {
  AdministrativeExportAuditInput,
  AdministrativeExportAuditReport,
  AuditLog,
  AuditLogPage,
  AuditLogSearch,
} from '../domain/types';
import type { AuditRepository } from '../ports/audit-repository';

function nullableObject(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | null {
  const value = record[key];
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(`Campo ${key} inválido na resposta do banco.`);
  return value;
}

function requiredObject(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = nullableObject(record, key);
  if (value === null) throw new Error(`Campo ${key} inválido na resposta do banco.`);
  return value;
}

function parseAuditLog(value: unknown): AuditLog {
  if (!isRecord(value)) throw new Error('Log de auditoria inválido na resposta do banco.');
  return {
    id: requiredString(value, 'id'),
    actorId: nullableString(value, 'actor_id'),
    action: requiredString(value, 'action'),
    entityType: requiredString(value, 'entity_type'),
    entityId: nullableString(value, 'entity_id'),
    requestId: nullableString(value, 'request_id'),
    oldData: nullableObject(value, 'old_data'),
    newData: nullableObject(value, 'new_data'),
    metadata: requiredObject(value, 'metadata'),
    createdAt: requiredString(value, 'created_at'),
  };
}

function parseExportReport(value: unknown): AdministrativeExportAuditReport {
  if (!isRecord(value)) throw new Error('Relatório inválido de auditoria da exportação.');
  return {
    auditLogId: requiredString(value, 'auditLogId'),
    exportId: requiredString(value, 'exportId'),
    createdAt: requiredString(value, 'createdAt'),
    applied: requiredBoolean(value, 'applied'),
  };
}

export class SupabaseAuditRepository implements AuditRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async search(query: AuditLogSearch): Promise<AuditLogPage> {
    const payload = parsePagePayload(
      await unwrapSupabaseResponse(
        this.client.rpc('search_audit_logs', {
          p_action: query.action ?? null,
          p_entity_type: query.entityType ?? null,
          p_entity_id: query.entityId ?? null,
          p_actor_id: query.actorId ?? null,
          p_request_id: query.requestId ?? null,
          p_created_from: query.createdFrom ?? null,
          p_created_to: query.createdTo ?? null,
          p_page: query.page,
          p_page_size: query.pageSize,
        }),
      ),
    );
    return createPaginatedResult(
      payload.items.map(parseAuditLog),
      payload.total,
      payload.page,
      payload.pageSize,
    );
  }

  async recordAdministrativeExport(
    input: AdministrativeExportAuditInput,
  ): Promise<AdministrativeExportAuditReport> {
    return parseExportReport(
      await unwrapSupabaseResponse(
        this.client.rpc('record_administrative_export', {
          p_export_type: input.exportType,
          p_format: input.format,
          p_row_count: input.rowCount,
          p_idempotency_key: input.idempotencyKey,
        }),
      ),
    );
  }
}
