import type {
  Supplier,
  SupplierPage,
  SupplierRecord,
  SupplierSearch,
  SupplierUpdateRecord,
} from '../domain/types';

export interface SupplierRepository {
  create(record: SupplierRecord): Promise<Supplier>;
  getById(id: string): Promise<Supplier | null>;
  search(query: SupplierSearch): Promise<SupplierPage>;
  update(id: string, record: SupplierUpdateRecord): Promise<Supplier>;
}
