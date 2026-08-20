import type { PageRequest, PaginatedResult } from '../../../types/pagination';

export interface Supplier {
  readonly id: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly document: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SupplierSearch extends PageRequest {
  readonly search?: string;
  readonly isActive?: boolean;
}

export type SupplierPage = PaginatedResult<Supplier>;

export interface CreateSupplierInput {
  readonly legalName: string;
  readonly tradeName?: string | null;
  readonly document?: string | null;
}

export interface UpdateSupplierInput {
  readonly legalName?: string;
  readonly tradeName?: string | null;
  readonly document?: string | null;
}

export interface SupplierRecord {
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly document: string | null;
}

export type SupplierUpdateRecord = Partial<SupplierRecord> & { readonly isActive?: boolean };
