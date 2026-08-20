import { ImportFileError } from '../domain/errors';
import type { ConfirmProductImportOptions, ProductImportReport } from '../domain/types';
import type { ImportConfirmationRepository } from '../ports/import-confirmation-repository';

export interface ConfirmProductImportInput extends ConfirmProductImportOptions {
  repository: ImportConfirmationRepository;
}

/**
 * Valida somente a forma da solicitação. Classificação, autorização, locks,
 * idempotência, promoção e estoque são revalidados pela RPC PostgreSQL.
 */
export function confirmProductImport(
  input: ConfirmProductImportInput,
): Promise<ProductImportReport> {
  const batchId = input.batchId.trim();
  const stockLocationId = input.stockLocationId?.trim();

  if (!batchId) {
    throw new ImportFileError(
      'INVALID_CONFIRMATION_OPTIONS',
      'O identificador do lote é obrigatório.',
    );
  }
  if (input.mode === 'INITIAL_MIGRATION' && input.masterQuantityStrategy !== undefined) {
    throw new ImportFileError(
      'INVALID_CONFIRMATION_OPTIONS',
      'INITIAL_MIGRATION não aceita estratégia de quantidade mestre.',
    );
  }
  if (
    input.mode === 'MASTER_DATA_IMPORT' &&
    input.masterQuantityStrategy === 'RECONCILE_TO_EXTERNAL_QUANTITY' &&
    !stockLocationId
  ) {
    throw new ImportFileError(
      'INVALID_CONFIRMATION_OPTIONS',
      'A reconciliação de quantidade exige um local de estoque.',
    );
  }

  return input.repository.confirmProductImport({
    batchId,
    mode: input.mode,
    existingProductStrategy: input.existingProductStrategy,
    ...(stockLocationId ? { stockLocationId } : {}),
    ...(input.masterQuantityStrategy
      ? { masterQuantityStrategy: input.masterQuantityStrategy }
      : {}),
  });
}
