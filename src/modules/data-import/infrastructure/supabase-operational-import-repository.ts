import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '../../../lib/supabase';
import { ImportFileError } from '../domain/errors';
import type {
  OperationalConfirmationOptions,
  OperationalConfirmationReport,
  OperationalConflictResolution,
  OperationalImportRepository,
  OperationalImportType,
  OperationalPreviewPage,
  OperationalPreviewSummary,
  StageOperationalPreviewInput,
} from '../domain/operational-types';

interface RpcResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function response(value: unknown): RpcResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Resposta inválida do Supabase.');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (!('data' in candidate) || !('error' in candidate)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Resposta inválida do Supabase.');
  }
  const error = candidate.error;
  if (error !== null && (typeof error !== 'object' || Array.isArray(error))) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Erro inválido do Supabase.');
  }
  return candidate as unknown as RpcResponse;
}

function data(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = response(value);
  if (parsed.error) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', parsed.error.message, {
      ...(parsed.error.code ? { databaseCode: parsed.error.code } : {}),
    });
  }
  const first: unknown = Array.isArray(parsed.data)
    ? (parsed.data as readonly unknown[])[0]
    : parsed.data;
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Relatório inválido do Supabase.');
  }
  return first as Readonly<Record<string, unknown>>;
}

function summary(value: unknown): OperationalPreviewSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Resumo de dry-run inválido.');
  }
  const source = value as Readonly<Record<string, unknown>>;
  const names: readonly (keyof OperationalPreviewSummary)[] = [
    'TOTAL',
    'VALID',
    'INVALID',
    'NEW',
    'UPDATE_CANDIDATE',
    'CONFLICT',
    'IGNORED',
    'POSITIVE',
    'NEGATIVE',
    'UNCHANGED',
  ];
  return Object.fromEntries(
    names.map((name) => [name, Number(source[name] ?? 0)]),
  ) as unknown as OperationalPreviewSummary;
}

function report(value: Readonly<Record<string, unknown>>): OperationalConfirmationReport {
  return {
    batchId: String(value.batch_id),
    importType: String(value.import_type) as OperationalImportType,
    applied: Boolean(value.applied),
    created: Number(value.created ?? 0),
    associated: Number(value.associated ?? 0),
    updated: Number(value.updated ?? 0),
    movementsCreated: Number(value.movements_created ?? 0),
    unchanged: Number(value.unchanged ?? 0),
    ignored: Number(value.ignored ?? 0),
    warnings: Number(value.warnings ?? 0),
    errors: Number(value.errors ?? 0),
  };
}

export class SupabaseOperationalImportRepository implements OperationalImportRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async stagePreview(input: StageOperationalPreviewInput) {
    const result = data(
      await this.client.rpc('stage_operational_import_preview', {
        p_import_type: input.importType,
        p_source_type: input.sourceType,
        p_source_name: input.sourceName,
        p_original_filename: input.originalFilename,
        p_file_hash: input.fileHash,
        p_file_size_bytes: input.fileSizeBytes,
        p_detected_headers: input.detectedHeaders,
        p_column_mapping: input.columnMapping,
        p_rows: input.rows,
        p_duplicate_of_batch_id: input.duplicateOfBatchId ?? null,
      }),
    );
    return {
      batchId: String(result.batch_id),
      status: String(result.status),
      summary: summary(result.summary),
    };
  }

  async getPreview(
    batchId: string,
    page: number,
    pageSize: number,
  ): Promise<OperationalPreviewPage> {
    const result = data(
      await this.client.rpc('get_operational_import_preview', {
        p_import_batch_id: batchId,
        p_page: page,
        p_page_size: pageSize,
      }),
    );
    return {
      batchId: String(result.batch_id),
      importType: String(result.import_type) as OperationalImportType,
      status: String(result.status),
      summary: summary(result.summary),
      rows: Array.isArray(result.rows) ? (result.rows as OperationalPreviewPage['rows']) : [],
      page: Number(result.page),
      pageSize: Number(result.page_size),
      totalRows: Number(result.total_rows),
    };
  }

  async resolve(
    batchId: string,
    resolutions: readonly OperationalConflictResolution[],
    approvedCategories: readonly string[],
  ): Promise<OperationalPreviewSummary> {
    const result = data(
      await this.client.rpc('resolve_operational_import', {
        p_import_batch_id: batchId,
        p_resolutions: resolutions,
        p_approved_categories: approvedCategories,
      }),
    );
    return summary(result.summary);
  }

  async confirm(options: OperationalConfirmationOptions): Promise<OperationalConfirmationReport> {
    if (options.importType === 'PRODUCTS') {
      return report(
        data(
          await this.client.rpc('confirm_operational_product_import', {
            p_import_batch_id: options.batchId,
            p_update_existing: options.updateExisting ?? false,
            p_idempotency_key: options.idempotencyKey,
          }),
        ),
      );
    }
    if (options.importType === 'STOCK_RECONCILIATION') {
      return report(
        data(
          await this.client.rpc('confirm_stock_reconciliation_import', {
            p_import_batch_id: options.batchId,
            p_stock_location_id: options.stockLocationId,
            p_reason: options.reason,
            p_idempotency_key: options.idempotencyKey,
          }),
        ),
      );
    }
    return report(
      data(
        await this.client.rpc('confirm_operational_master_data_import', {
          p_import_batch_id: options.batchId,
          p_update_existing: options.updateExisting ?? false,
          p_idempotency_key: options.idempotencyKey,
        }),
      ),
    );
  }
}
