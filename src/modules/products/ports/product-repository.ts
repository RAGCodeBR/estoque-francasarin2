import type {
  Product,
  ProductCreateRecord,
  ProductPage,
  ProductSearch,
  ProductUpdateRecord,
} from '../domain/types';

export interface ProductRepository {
  create(record: ProductCreateRecord): Promise<Product>;
  getById(id: string): Promise<Product | null>;
  search(query: ProductSearch): Promise<ProductPage>;
  update(id: string, record: ProductUpdateRecord): Promise<Product>;
  setActive(id: string, isActive: boolean): Promise<Product>;
}
