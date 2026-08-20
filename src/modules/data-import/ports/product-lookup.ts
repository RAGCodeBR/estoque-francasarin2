import type {
  ProductIdentityMatch,
  ProductIdentityQuery,
  ProductNameQuery,
  ProductNameSuggestion,
} from '../domain/types';

export interface ProductLookup {
  findIdentityMatches(
    queries: readonly ProductIdentityQuery[],
  ): Promise<readonly ProductIdentityMatch[]>;
  suggestBySimilarNames(
    queries: readonly ProductNameQuery[],
  ): Promise<readonly ProductNameSuggestion[]>;
}
