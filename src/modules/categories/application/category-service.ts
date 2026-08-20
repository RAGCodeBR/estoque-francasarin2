import { resolvePageRequest } from '../../../types/pagination';
import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeSearch,
} from '../../../utils/domain-values';
import type {
  Category,
  CategoryPage,
  CategorySearch,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../domain/types';
import type { CategoryRepository } from '../ports/category-repository';

export class CategoryService {
  constructor(private readonly repository: CategoryRepository) {}

  create(input: CreateCategoryInput): Promise<Category> {
    return this.repository.create({
      name: normalizeRequiredText(input.name, 'Nome da categoria'),
      description: normalizeOptionalText(input.description),
    });
  }

  getById(id: string): Promise<Category | null> {
    return this.repository.getById(assertUuid(id, 'ID da categoria'));
  }

  search(query: CategorySearch = {}): Promise<CategoryPage> {
    const page = resolvePageRequest(query);
    const search = normalizeSearch(query.search);
    return this.repository.search({
      ...page,
      ...(search ? { search } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    });
  }

  update(id: string, input: UpdateCategoryInput): Promise<Category> {
    const record = {
      ...(input.name === undefined
        ? {}
        : { name: normalizeRequiredText(input.name, 'Nome da categoria') }),
      ...(input.description === undefined
        ? {}
        : { description: normalizeOptionalText(input.description) }),
    };
    if (Object.keys(record).length === 0) throw new Error('Informe ao menos um campo para edição.');
    return this.repository.update(assertUuid(id, 'ID da categoria'), record);
  }

  deactivate(id: string): Promise<Category> {
    return this.repository.setActive(assertUuid(id, 'ID da categoria'), false);
  }

  reactivate(id: string): Promise<Category> {
    return this.repository.setActive(assertUuid(id, 'ID da categoria'), true);
  }
}
