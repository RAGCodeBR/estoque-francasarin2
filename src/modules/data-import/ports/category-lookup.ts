import type { ExistingCategory } from '../domain/types';

export interface CategoryLookup {
  findByNormalizedNames(names: readonly string[]): Promise<readonly ExistingCategory[]>;
}
