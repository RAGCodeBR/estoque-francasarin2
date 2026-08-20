import { describe, expect, it } from 'vitest';

import {
  SupplierService,
  type Supplier,
  type SupplierRepository,
} from '../../../src/modules/suppliers';

const supplier: Supplier = {
  id: '11111111-1111-4111-8111-111111111111',
  legalName: 'Fornecedor Ltda',
  tradeName: null,
  document: '11222333000181',
  isActive: true,
  createdAt: '2026-08-20T00:00:00Z',
  updatedAt: '2026-08-20T00:00:00Z',
};

class MemorySupplierRepository implements SupplierRepository {
  lastRecord: unknown;
  create(record: Parameters<SupplierRepository['create']>[0]): Promise<Supplier> {
    this.lastRecord = record;
    return Promise.resolve(supplier);
  }
  getById(): Promise<Supplier | null> {
    return Promise.resolve(supplier);
  }
  search(
    query: Parameters<SupplierRepository['search']>[0],
  ): ReturnType<SupplierRepository['search']> {
    this.lastRecord = query;
    return Promise.resolve({ items: [supplier], page: 1, pageSize: 25, total: 1, totalPages: 1 });
  }
  update(_id: string, record: Parameters<SupplierRepository['update']>[1]): Promise<Supplier> {
    this.lastRecord = record;
    return Promise.resolve(supplier);
  }
}

describe('serviço de fornecedores', () => {
  it('normaliza razão social, nome fantasia e CNPJ sem formatação', async () => {
    const repository = new MemorySupplierRepository();
    await new SupplierService(repository).create({
      legalName: '  Fornecedor   Ltda ',
      tradeName: '  Loja  ',
      document: '11.222.333/0001-81',
    });
    expect(repository.lastRecord).toEqual({
      legalName: 'Fornecedor Ltda',
      tradeName: 'Loja',
      document: '11222333000181',
    });
  });

  it('pagina no servidor e limita a 100 registros', async () => {
    const repository = new MemorySupplierRepository();
    const service = new SupplierService(repository);
    await service.search({ search: '  arroz  ', page: 1, pageSize: 100 });
    expect(repository.lastRecord).toEqual({ search: 'arroz', page: 1, pageSize: 100 });
    expect(() => service.search({ pageSize: 101 })).toThrow(/entre 1 e 100/);
  });

  it('não expõe delete e rejeita documento ou edição vazia', () => {
    const service = new SupplierService(new MemorySupplierRepository());
    expect('delete' in service).toBe(false);
    expect(() => service.create({ legalName: 'Fornecedor', document: '123' })).toThrow(
      /14 dígitos/,
    );
    expect(() => service.update(supplier.id, {})).toThrow(/ao menos um campo/);
  });
});
