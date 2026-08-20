import type {
  Category,
  CategoryCreateRecord,
  CategoryPage,
  CategorySearch,
  CategoryUpdateRecord,
} from '../domain/types';

export interface CategoryRepository {
  create(record: CategoryCreateRecord): Promise<Category>;
  getById(id: string): Promise<Category | null>;
  search(query: CategorySearch): Promise<CategoryPage>;
  update(id: string, record: CategoryUpdateRecord): Promise<Category>;
  setActive(id: string, isActive: boolean): Promise<Category>;
}
