import type { PageRequest, PaginatedResult } from '../../../types/pagination';

export type ProductType = 'RAW' | 'FRACTIONATED';
export type UnitType = 'UN' | 'KG';

export interface ProductCategory {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  productType: ProductType;
  unit: UnitType;
  category: ProductCategory;
  minimumQuantity: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  name: string;
  sku: string;
  ean?: string | null;
  categoryId: string;
  productType: ProductType;
  unit: UnitType;
  minimumQuantity?: string;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  ean?: string | null;
  categoryId?: string;
  productType?: ProductType;
  unit?: UnitType;
  minimumQuantity?: string;
}

export interface ProductSearch extends PageRequest {
  search?: string;
  categoryId?: string;
  productType?: ProductType;
  unit?: UnitType;
  isActive?: boolean;
}

export type ProductPage = PaginatedResult<Product>;

export interface ProductCreateRecord {
  name: string;
  sku: string;
  ean: string | null;
  categoryId: string;
  productType: ProductType;
  unit: UnitType;
  minimumQuantity: string;
}

export interface ProductUpdateRecord {
  name?: string;
  sku?: string;
  ean?: string | null;
  categoryId?: string;
  productType?: ProductType;
  unit?: UnitType;
  minimumQuantity?: string;
  isActive?: boolean;
}
