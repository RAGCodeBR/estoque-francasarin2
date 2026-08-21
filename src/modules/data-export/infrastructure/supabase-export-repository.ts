import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getSupabaseClient,
  isRecord,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import {
  OPERATIONAL_EXPORT_TYPES,
  type ExportAuditInput,
  type ExportAuditReceipt,
  type ExportCellValue,
  type ExportDataPage,
  type ExportPageRequest,
  type ExportRow,
  type OperationalExportFilters,
  type OperationalExportType,
} from '../domain/types';
import type { OperationalExportRepository } from '../ports/export-repository';

function requiredInteger(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Campo ${key} inválido na resposta do banco.`);
  }
  return value;
}

function parseExportType(value: unknown): OperationalExportType {
  if (
    typeof value !== 'string' ||
    !OPERATIONAL_EXPORT_TYPES.includes(value as OperationalExportType)
  ) {
    throw new Error('Tipo de exportação inválido na resposta do banco.');
  }
  return value as OperationalExportType;
}

function parseRow(value: unknown): ExportRow {
  if (!isRecord(value)) throw new Error('Linha inválida na resposta da exportação.');
  const result: Record<string, ExportCellValue> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (cell !== null && typeof cell !== 'string' && typeof cell !== 'boolean') {
      throw new Error(`Valor inválido na coluna exportada ${key}.`);
    }
    result[key] = cell;
  }
  return result;
}

function parsePage(value: unknown): ExportDataPage {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error('Página de exportação inválida na resposta do banco.');
  }
  return {
    schemaVersion: requiredInteger(value, 'schema_version'),
    exportType: parseExportType(value.export_type),
    page: requiredInteger(value, 'page'),
    pageSize: requiredInteger(value, 'page_size'),
    total: requiredInteger(value, 'total'),
    rows: value.rows.map(parseRow),
  };
}

function filtersToDatabase(filters: OperationalExportFilters): Readonly<Record<string, unknown>> {
  return {
    ...(filters.search === undefined ? {} : { search: filters.search }),
    ...(filters.isActive === undefined ? {} : { is_active: filters.isActive }),
    ...(filters.categoryId === undefined ? {} : { category_id: filters.categoryId }),
    ...(filters.productId === undefined ? {} : { product_id: filters.productId }),
    ...(filters.supplierId === undefined ? {} : { supplier_id: filters.supplierId }),
    ...(filters.locationId === undefined ? {} : { location_id: filters.locationId }),
    ...(filters.productType === undefined ? {} : { product_type: filters.productType }),
    ...(filters.unit === undefined ? {} : { unit: filters.unit }),
    ...(filters.locationType === undefined ? {} : { location_type: filters.locationType }),
    ...(filters.movementType === undefined ? {} : { movement_type: filters.movementType }),
    ...(filters.invoiceStatus === undefined ? {} : { invoice_status: filters.invoiceStatus }),
    ...(filters.createdFrom === undefined ? {} : { created_from: filters.createdFrom }),
    ...(filters.createdTo === undefined ? {} : { created_to: filters.createdTo }),
  };
}

function parseAuditReceipt(value: unknown): ExportAuditReceipt {
  if (!isRecord(value)) throw new Error('Recibo de auditoria inválido na resposta do banco.');
  return {
    auditLogId: requiredString(value, 'auditLogId'),
    exportId: requiredString(value, 'exportId'),
    createdAt: requiredString(value, 'createdAt'),
    applied: requiredBoolean(value, 'applied'),
  };
}

export class SupabaseOperationalExportRepository implements OperationalExportRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async fetchPage(request: ExportPageRequest): Promise<ExportDataPage> {
    return parsePage(
      await unwrapSupabaseResponse(
        this.client.rpc('export_operational_data_page', {
          p_export_type: request.type,
          p_filters: filtersToDatabase(request.filters),
          p_selected_ids: request.selectedIds,
          p_page: request.page,
          p_page_size: request.pageSize,
        }),
      ),
    );
  }

  async recordCompletion(input: ExportAuditInput): Promise<ExportAuditReceipt> {
    return parseAuditReceipt(
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
