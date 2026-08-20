import { resolvePageRequest } from '../../../types/pagination';
import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeSearch,
} from '../../../utils/domain-values';
import { isValidCnpj } from '../../../utils/cnpj';
import type {
  CreateSupplierInput,
  Supplier,
  SupplierPage,
  SupplierSearch,
  UpdateSupplierInput,
} from '../domain/types';
import type { SupplierRepository } from '../ports/supplier-repository';

function normalizeDocument(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)?.replaceAll(/\D/g, '') ?? null;
  if (normalized !== null && !isValidCnpj(normalized))
    throw new Error('Documento do fornecedor deve ser um CNPJ válido com 14 dígitos.');
  return normalized;
}

export class SupplierService {
  constructor(private readonly repository: SupplierRepository) {}

  create(input: CreateSupplierInput): Promise<Supplier> {
    return this.repository.create({
      legalName: normalizeRequiredText(input.legalName, 'Razão social'),
      tradeName: normalizeOptionalText(input.tradeName),
      document: normalizeDocument(input.document),
    });
  }

  getById(id: string): Promise<Supplier | null> {
    return this.repository.getById(assertUuid(id, 'ID do fornecedor'));
  }

  search(query: SupplierSearch = {}): Promise<SupplierPage> {
    const search = normalizeSearch(query.search);
    return this.repository.search({
      ...resolvePageRequest(query),
      ...(search ? { search } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    });
  }

  update(id: string, input: UpdateSupplierInput): Promise<Supplier> {
    const record = {
      ...(input.legalName === undefined
        ? {}
        : { legalName: normalizeRequiredText(input.legalName, 'Razão social') }),
      ...(input.tradeName === undefined
        ? {}
        : { tradeName: normalizeOptionalText(input.tradeName) }),
      ...(input.document === undefined ? {} : { document: normalizeDocument(input.document) }),
    };
    if (Object.keys(record).length === 0) throw new Error('Informe ao menos um campo para edição.');
    return this.repository.update(assertUuid(id, 'ID do fornecedor'), record);
  }

  deactivate(id: string): Promise<Supplier> {
    return this.repository.update(assertUuid(id, 'ID do fornecedor'), { isActive: false });
  }

  reactivate(id: string): Promise<Supplier> {
    return this.repository.update(assertUuid(id, 'ID do fornecedor'), { isActive: true });
  }
}
