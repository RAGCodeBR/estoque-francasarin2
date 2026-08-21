import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient, isRecord } from '../../../lib/supabase';
import { ImportFileError } from '../domain/errors';
import type {
  ProductImportPreviewPage,
  ProductImportPreviewRow,
  ProductImportPreviewSummary,
  ProductImportWizardRepository,
  ProductImportConflictResolution,
  StageProductImportPreviewInput,
} from '../domain/import-wizard-types';
import type { ProductImportMode, ValidationState } from '../domain/types';

interface RpcResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value) || !('data' in value) || !('error' in value)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Resposta inválida do Supabase.');
  }
  const response = value as unknown as RpcResponse;
  if (response.error) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', response.error.message, {
      ...(response.error.code ? { databaseCode: response.error.code } : {}),
    });
  }
  return Array.isArray(response.data) ? response.data[0] : response.data;
}

function numberField(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = Number(record[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', `Métrica inválida: ${key}.`);
  }
  return value;
}

function parseSummary(value: unknown): ProductImportPreviewSummary {
  if (!isRecord(value)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Resumo de importação inválido.');
  }
  return {
    TOTAL: numberField(value, 'TOTAL'),
    VALID: numberField(value, 'VALID'),
    INVALID: numberField(value, 'INVALID'),
    NEW: numberField(value, 'NEW'),
    UPDATE_CANDIDATE: numberField(value, 'UPDATE_CANDIDATE'),
    CONFLICT: numberField(value, 'CONFLICT'),
    IGNORED: numberField(value, 'IGNORED'),
    WARNING: numberField(value, 'WARNING'),
    CATEGORIES_NEW: numberField(value, 'CATEGORIES_NEW'),
  };
}

function parseMode(value: unknown): ProductImportMode {
  if (value !== 'INITIAL_MIGRATION' && value !== 'MASTER_DATA_IMPORT') {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Modo de importação inválido.');
  }
  return value;
}

function parseState(value: unknown): ValidationState | null {
  if (value === null) return null;
  if (
    value !== 'VALID' &&
    value !== 'WARNING' &&
    value !== 'ERROR' &&
    value !== 'CONFLICT' &&
    value !== 'IGNORED'
  ) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Estado de linha inválido.');
  }
  return value;
}

function parseRow(value: unknown): ProductImportPreviewRow {
  if (!isRecord(value) || typeof value.rowNumber !== 'number' || !isRecord(value.rawData)) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Linha de preview inválida.');
  }
  const action = value.action;
  if (
    action !== null &&
    action !== 'NEW' &&
    action !== 'UPDATE_CANDIDATE' &&
    action !== 'CONFLICT' &&
    action !== 'IGNORED'
  ) {
    throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Ação de preview inválida.');
  }
  return {
    rowNumber: value.rowNumber,
    rawData: value.rawData as ProductImportPreviewRow['rawData'],
    normalizedData: isRecord(value.normalizedData)
      ? (value.normalizedData as unknown as ProductImportPreviewRow['normalizedData'])
      : null,
    state: parseState(value.state),
    action,
    issues: Array.isArray(value.issues) ? (value.issues as ProductImportPreviewRow['issues']) : [],
    ...(typeof value.resolvedEntityId === 'string'
      ? { resolvedEntityId: value.resolvedEntityId }
      : {}),
    ...(isRecord(value.categoryCandidate)
      ? {
          categoryCandidate: value.categoryCandidate as unknown as NonNullable<
            ProductImportPreviewRow['categoryCandidate']
          >,
        }
      : {}),
    ...(Array.isArray(value.suggestions)
      ? {
          suggestions: value.suggestions as NonNullable<ProductImportPreviewRow['suggestions']>,
        }
      : {}),
  };
}

export class SupabaseProductImportWizardRepository implements ProductImportWizardRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async stagePreview(input: StageProductImportPreviewInput): Promise<{ batchId: string }> {
    const data = unwrap(
      await this.client.rpc('stage_product_import_preview', {
        p_mode: input.mode,
        p_source_type: input.sourceType,
        p_source_name: input.sourceName,
        p_original_filename: input.originalFilename,
        p_file_hash: input.fileHash,
        p_file_size_bytes: input.fileSizeBytes,
        p_detected_headers: input.detectedHeaders,
        p_column_mapping: input.columnMapping,
        p_value_mapping: input.valueMappings,
        p_rows: input.rows,
        p_duplicate_of_batch_id: input.duplicateOfBatchId ?? null,
      }),
    );
    if (!isRecord(data) || typeof data.batch_id !== 'string') {
      throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Lote de staging inválido.');
    }
    return { batchId: data.batch_id };
  }

  async getPreview(
    batchId: string,
    page: number,
    pageSize: number,
  ): Promise<ProductImportPreviewPage> {
    const data = unwrap(
      await this.client.rpc('get_product_import_preview', {
        p_import_batch_id: batchId,
        p_page: page,
        p_page_size: pageSize,
      }),
    );
    if (!isRecord(data) || !Array.isArray(data.rows) || typeof data.batch_id !== 'string') {
      throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Preview de importação inválido.');
    }
    return {
      batchId: data.batch_id,
      mode: parseMode(data.mode),
      status: String(data.status),
      summary: parseSummary(data.summary),
      rows: data.rows.map(parseRow),
      page: numberField(data, 'page'),
      pageSize: numberField(data, 'page_size'),
      totalRows: numberField(data, 'total_rows'),
    };
  }

  async resolve(
    batchId: string,
    resolutions: readonly ProductImportConflictResolution[],
    approvedCategories: readonly string[],
  ): Promise<ProductImportPreviewSummary> {
    const data = unwrap(
      await this.client.rpc('resolve_operational_import', {
        p_import_batch_id: batchId,
        p_resolutions: resolutions,
        p_approved_categories: approvedCategories,
      }),
    );
    if (!isRecord(data)) {
      throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', 'Resolução de conflitos inválida.');
    }
    return parseSummary(data.summary);
  }
}
