export { ProductService } from './application/product-service';
export { SupabaseProductRepository } from './infrastructure/supabase-product-repository';
export type {
  CreateProductInput,
  Product,
  ProductCategory,
  ProductPage,
  ProductSearch,
  ProductType,
  UnitType,
  UpdateProductInput,
} from './domain/types';
export type { ProductRepository } from './ports/product-repository';
