import type { PageRequest, PaginatedResult } from '../../../types/pagination';

export interface Category {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  name: string;
  description?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string | null;
}

export interface CategorySearch extends PageRequest {
  search?: string;
  isActive?: boolean;
}

export type CategoryPage = PaginatedResult<Category>;

export interface CategoryCreateRecord {
  name: string;
  description: string | null;
}

export interface CategoryUpdateRecord {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}
