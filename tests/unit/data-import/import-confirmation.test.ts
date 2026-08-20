import { describe, expect, it } from 'vitest';

import { confirmProductImport } from '../../../src/modules/data-import/application/confirm-product-import';
import { ImportFileError } from '../../../src/modules/data-import/domain/errors';
import type {
  ConfirmProductImportOptions,
  ProductImportReport,
} from '../../../src/modules/data-import/domain/types';
import type { ImportConfirmationRepository } from '../../../src/modules/data-import/ports/import-confirmation-repository';

const report: ProductImportReport = {
  batchId: 'batch-id',
  importMode: 'INITIAL_MIGRATION',
  applied: true,
  productsCreated: 1,
  productsAssociated: 0,
  productsUpdated: 0,
  categoriesCreated: 1,
  movementsCreated: 1,
  linesIgnored: 0,
  externalQuantitiesIgnored: 0,
  warnings: 0,
  errors: 0,
};

class ConfirmationRepository implements ImportConfirmationRepository {
  readonly calls: ConfirmProductImportOptions[] = [];

  confirmProductImport(options: ConfirmProductImportOptions): Promise<ProductImportReport> {
    this.calls.push(options);
    return Promise.resolve({ ...report, batchId: options.batchId, importMode: options.mode });
  }
}

describe('confirmação de importação no domínio TypeScript', () => {
  it('normaliza IDs e encaminha somente opções explícitas ao repositório transacional', async () => {
    const repository = new ConfirmationRepository();
    await expect(
      confirmProductImport({
        repository,
        batchId: '  batch-id  ',
        mode: 'INITIAL_MIGRATION',
        existingProductStrategy: 'ASSOCIATE_ONLY',
        stockLocationId: '  stock-id  ',
      }),
    ).resolves.toMatchObject({ batchId: 'batch-id', applied: true });
    expect(repository.calls).toEqual([
      {
        batchId: 'batch-id',
        mode: 'INITIAL_MIGRATION',
        existingProductStrategy: 'ASSOCIATE_ONLY',
        stockLocationId: 'stock-id',
      },
    ]);
  });

  it('rejeita estratégia mestre na migração inicial antes de chamar o banco', () => {
    const repository = new ConfirmationRepository();
    expect(() =>
      confirmProductImport({
        repository,
        batchId: 'batch-id',
        mode: 'INITIAL_MIGRATION',
        existingProductStrategy: 'ASSOCIATE_ONLY',
        masterQuantityStrategy: 'IGNORE_EXTERNAL_QUANTITY',
      }),
    ).toThrow(ImportFileError);
    expect(repository.calls).toEqual([]);
  });

  it('exige local para reconciliação de quantidade mestre', () => {
    const repository = new ConfirmationRepository();
    expect(() =>
      confirmProductImport({
        repository,
        batchId: 'batch-id',
        mode: 'MASTER_DATA_IMPORT',
        existingProductStrategy: 'UPDATE_MASTER_DATA',
        masterQuantityStrategy: 'RECONCILE_TO_EXTERNAL_QUANTITY',
      }),
    ).toThrow(/local de estoque/i);
    expect(repository.calls).toEqual([]);
  });
});
