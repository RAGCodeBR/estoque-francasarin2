export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page?: number;
  pageSize?: number;
}

export interface ResolvedPageRequest {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> extends ResolvedPageRequest {
  items: readonly T[];
  total: number;
  totalPages: number;
}

export function resolvePageRequest(request: PageRequest = {}): ResolvedPageRequest {
  const page = request.page ?? 1;
  const pageSize = request.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(page) || page < 1)
    throw new Error('A página deve ser um inteiro positivo.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`O tamanho da página deve estar entre 1 e ${String(MAX_PAGE_SIZE)}.`);
  }
  return { page, pageSize };
}

export function createPaginatedResult<T>(
  items: readonly T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Total paginado inválido.');
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
