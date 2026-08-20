import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '../../../lib/supabase';
import { ImportFileError } from '../domain/errors';
import type {
  ConfirmProductImportOptions,
  ProductImportMode,
  ProductImportReport,
} from '../domain/types';
import type { ImportConfirmationRepository } from '../ports/import-confirmation-repository';

interface RpcConfirmationRow {
  batch_id: string;
  import_mode: ProductImportMode;
  applied: boolean;
  products_created: number;
  products_associated: number;
  products_updated: number;
  categories_created: number;
  movements_created: number;
  lines_ignored: number;
  external_quantities_ignored: number;
  warnings: number;
  errors: number;
}

interface RpcResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as Readonly<Record<string, unknown>>;
  if (!('data' in response) || !('error' in response)) return false;
  if (response.error === null) return true;
  if (typeof response.error !== 'object' || Array.isArray(response.error)) return false;
  const error = response.error as Readonly<Record<string, unknown>>;
  return (
    typeof error.message === 'string' &&
    (error.code === undefined || typeof error.code === 'string')
  );
}

function firstArrayItem(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  const items: readonly unknown[] = value;
  return items[0];
}

function isRpcConfirmationRow(value: unknown): value is RpcConfirmationRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Readonly<Record<string, unknown>>;
  return (
    typeof row.batch_id === 'string' &&
    (row.import_mode === 'INITIAL_MIGRATION' || row.import_mode === 'MASTER_DATA_IMPORT') &&
    typeof row.applied === 'boolean' &&
    typeof row.products_created === 'number' &&
    typeof row.products_associated === 'number' &&
    typeof row.products_updated === 'number' &&
    typeof row.categories_created === 'number' &&
    typeof row.movements_created === 'number' &&
    typeof row.lines_ignored === 'number' &&
    typeof row.external_quantities_ignored === 'number' &&
    typeof row.warnings === 'number' &&
    typeof row.errors === 'number'
  );
}

function toReport(row: RpcConfirmationRow): ProductImportReport {
  return {
    batchId: row.batch_id,
    importMode: row.import_mode,
    applied: row.applied,
    productsCreated: row.products_created,
    productsAssociated: row.products_associated,
    productsUpdated: row.products_updated,
    categoriesCreated: row.categories_created,
    movementsCreated: row.movements_created,
    linesIgnored: row.lines_ignored,
    externalQuantitiesIgnored: row.external_quantities_ignored,
    warnings: row.warnings,
    errors: row.errors,
  };
}

export class SupabaseImportConfirmationRepository implements ImportConfirmationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async confirmProductImport(options: ConfirmProductImportOptions): Promise<ProductImportReport> {
    const rpcResponse: unknown = await this.client.rpc('confirm_product_import', {
      p_import_batch_id: options.batchId,
      p_mode: options.mode,
      p_existing_product_strategy: options.existingProductStrategy,
      p_stock_location_id: options.stockLocationId ?? null,
      p_master_quantity_strategy: options.masterQuantityStrategy ?? null,
    });

    if (!isRpcResponse(rpcResponse)) {
      throw new ImportFileError(
        'IMPORT_CONFIRMATION_FAILED',
        'O cliente Supabase retornou uma resposta inválida.',
      );
    }

    if (rpcResponse.error) {
      throw new ImportFileError('IMPORT_CONFIRMATION_FAILED', rpcResponse.error.message, {
        ...(rpcResponse.error.code ? { databaseCode: rpcResponse.error.code } : {}),
      });
    }
    const row = firstArrayItem(rpcResponse.data);
    if (!isRpcConfirmationRow(row)) {
      throw new ImportFileError(
        'IMPORT_CONFIRMATION_FAILED',
        'O banco não retornou um relatório de confirmação válido.',
      );
    }
    return toReport(row);
  }
}
