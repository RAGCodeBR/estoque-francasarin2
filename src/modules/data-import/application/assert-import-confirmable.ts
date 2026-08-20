import { ImportFileError } from '../domain/errors';
import type { DryRunResult } from '../domain/types';

/**
 * Barreira de domínio para a futura confirmação. Não promove nem grava dados oficiais.
 */
export function assertImportConfirmable(result: DryRunResult): void {
  const blockingRows = result.rows
    .filter(({ state }) => state === 'ERROR' || state === 'CONFLICT')
    .map(({ rowNumber, state }) => ({ rowNumber, state }));

  if (blockingRows.length > 0) {
    throw new ImportFileError(
      'IMPORT_NOT_CONFIRMABLE',
      'A importação possui erros ou conflitos críticos não resolvidos.',
      { blockingRows },
    );
  }

  const pendingCategories = result.rows
    .flatMap(({ categoryCandidate }) => (categoryCandidate ? [categoryCandidate] : []))
    .filter(({ approvedForCreation }) => !approvedForCreation)
    .map(({ normalizedName }) => normalizedName);

  if (pendingCategories.length > 0) {
    throw new ImportFileError(
      'IMPORT_NOT_CONFIRMABLE',
      'A importação possui categorias candidatas ainda não aprovadas para criação.',
      { pendingCategories: [...new Set(pendingCategories)] },
    );
  }
}
