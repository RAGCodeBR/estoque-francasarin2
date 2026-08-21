import { ImportFileError } from '../domain/errors';
import type {
  OperationalConfirmationOptions,
  OperationalConfirmationReport,
  OperationalConflictResolution,
  OperationalImportRepository,
  OperationalPreviewPage,
  OperationalPreviewSummary,
} from '../domain/operational-types';

export class OperationalImportService {
  constructor(private readonly repository: OperationalImportRepository) {}

  getPreview(batchId: string, page = 1, pageSize = 100): Promise<OperationalPreviewPage> {
    if (!batchId.trim()) throw new TypeError('batchId é obrigatório.');
    if (!Number.isInteger(page) || page < 1) throw new RangeError('page deve ser positivo.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new RangeError('pageSize deve estar entre 1 e 500.');
    }
    return this.repository.getPreview(batchId, page, pageSize);
  }

  resolveConflicts(
    batchId: string,
    resolutions: readonly OperationalConflictResolution[],
    approvedCategories: readonly string[] = [],
  ): Promise<OperationalPreviewSummary> {
    if (!batchId.trim()) throw new TypeError('batchId é obrigatório.');
    return this.repository.resolve(batchId, resolutions, approvedCategories);
  }

  confirm(options: OperationalConfirmationOptions): Promise<OperationalConfirmationReport> {
    if (!options.batchId.trim() || !options.idempotencyKey.trim()) {
      throw new TypeError('batchId e idempotencyKey são obrigatórios.');
    }
    if (options.importType === 'STOCK_RECONCILIATION') {
      if (!options.stockLocationId) {
        throw new ImportFileError(
          'IMPORT_CONFIRMATION_FAILED',
          'O local de estoque é obrigatório para reconciliação.',
        );
      }
      if (options.reason?.normalize('NFKC').trim() !== 'Reconciliação via importação') {
        throw new ImportFileError(
          'IMPORT_CONFIRMATION_FAILED',
          'A reconciliação exige o motivo "Reconciliação via importação".',
        );
      }
    } else if (options.stockLocationId || options.reason) {
      throw new ImportFileError(
        'IMPORT_CONFIRMATION_FAILED',
        'Local e motivo de reconciliação não são aceitos em importações de cadastro.',
      );
    }
    return this.repository.confirm(options);
  }
}
