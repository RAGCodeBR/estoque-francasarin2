import { describe, expect, it } from 'vitest';

import { CategoryService } from '../../src/modules/categories/application/category-service';
import type {
  Category,
  CategoryCreateRecord,
  CategoryPage,
  CategorySearch,
  CategoryUpdateRecord,
} from '../../src/modules/categories/domain/types';
import type { CategoryRepository } from '../../src/modules/categories/ports/category-repository';
import { LocationService } from '../../src/modules/locations/application/location-service';
import type {
  Location,
  LocationCreateRecord,
  LocationPage,
  LocationSearch,
  LocationUpdateRecord,
} from '../../src/modules/locations/domain/types';
import type { LocationRepository } from '../../src/modules/locations/ports/location-repository';
import { ProductService } from '../../src/modules/products/application/product-service';
import type {
  CreateProductInput,
  Product,
  ProductCreateRecord,
  ProductPage,
  ProductSearch,
  ProductUpdateRecord,
} from '../../src/modules/products/domain/types';
import type { ProductRepository } from '../../src/modules/products/ports/product-repository';

const ids = {
  entity: '10000000-0000-4000-8000-000000000001',
  category: '20000000-0000-4000-8000-000000000001',
} as const;

const category: Category = {
  id: ids.entity,
  name: 'Ingredientes',
  description: null,
  isActive: true,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const location: Location = {
  id: ids.entity,
  name: 'Estoque central',
  description: null,
  locationType: 'STOCK',
  isActive: true,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const product: Product = {
  id: ids.entity,
  name: 'Arroz',
  sku: 'ARROZ-001',
  ean: '7894900011517',
  productType: 'RAW',
  unit: 'KG',
  category: { id: ids.category, name: 'Ingredientes' },
  minimumQuantity: '2.000',
  isActive: true,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

function page<T>(
  item: T,
  request: { page?: number; pageSize?: number },
): {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  return {
    items: [item],
    total: 1,
    page: request.page ?? 1,
    pageSize: request.pageSize ?? 25,
    totalPages: 1,
  };
}

class CategoryRepositoryFixture implements CategoryRepository {
  created?: CategoryCreateRecord;
  updated?: CategoryUpdateRecord;
  searched?: CategorySearch;
  activeValues: boolean[] = [];

  create(record: CategoryCreateRecord): Promise<Category> {
    this.created = record;
    return Promise.resolve(category);
  }
  getById(): Promise<Category | null> {
    return Promise.resolve(category);
  }
  search(query: CategorySearch): Promise<CategoryPage> {
    this.searched = query;
    return Promise.resolve(page(category, query));
  }
  update(_id: string, record: CategoryUpdateRecord): Promise<Category> {
    this.updated = record;
    return Promise.resolve(category);
  }
  setActive(_id: string, isActive: boolean): Promise<Category> {
    this.activeValues.push(isActive);
    return Promise.resolve({ ...category, isActive });
  }
}

class LocationRepositoryFixture implements LocationRepository {
  created?: LocationCreateRecord;
  updated?: LocationUpdateRecord;
  searched?: LocationSearch;
  activeValues: boolean[] = [];

  create(record: LocationCreateRecord): Promise<Location> {
    this.created = record;
    return Promise.resolve(location);
  }
  getById(): Promise<Location | null> {
    return Promise.resolve(location);
  }
  search(query: LocationSearch): Promise<LocationPage> {
    this.searched = query;
    return Promise.resolve(page(location, query));
  }
  update(_id: string, record: LocationUpdateRecord): Promise<Location> {
    this.updated = record;
    return Promise.resolve(location);
  }
  setActive(_id: string, isActive: boolean): Promise<Location> {
    this.activeValues.push(isActive);
    return Promise.resolve({ ...location, isActive });
  }
}

class ProductRepositoryFixture implements ProductRepository {
  created?: ProductCreateRecord;
  updated?: ProductUpdateRecord;
  searched?: ProductSearch;
  activeValues: boolean[] = [];

  create(record: ProductCreateRecord): Promise<Product> {
    this.created = record;
    return Promise.resolve(product);
  }
  getById(): Promise<Product | null> {
    return Promise.resolve(product);
  }
  search(query: ProductSearch): Promise<ProductPage> {
    this.searched = query;
    return Promise.resolve(page(product, query));
  }
  update(_id: string, record: ProductUpdateRecord): Promise<Product> {
    this.updated = record;
    return Promise.resolve(product);
  }
  setActive(_id: string, isActive: boolean): Promise<Product> {
    this.activeValues.push(isActive);
    return Promise.resolve({ ...product, isActive });
  }
}

describe('serviços de categorias e locais', () => {
  it('normaliza cadastro, edição e pesquisa paginada de categorias', async () => {
    const repository = new CategoryRepositoryFixture();
    const service = new CategoryService(repository);
    await service.create({ name: '  Carnes   nobres  ', description: '  Resfriados  ' });
    await service.update(ids.entity, { description: '   ' });
    await service.search({ page: 2, pageSize: 10, search: '  carne  ', isActive: true });
    await service.deactivate(ids.entity);
    await service.reactivate(ids.entity);

    expect(repository.created).toEqual({ name: 'Carnes nobres', description: 'Resfriados' });
    expect(repository.updated).toEqual({ description: null });
    expect(repository.searched).toEqual({ page: 2, pageSize: 10, search: 'carne', isActive: true });
    expect(repository.activeValues).toEqual([false, true]);
    expect('delete' in service).toBe(false);
  });

  it('valida tipos e paginação de locais sem carregar a coleção completa', async () => {
    const repository = new LocationRepositoryFixture();
    const service = new LocationService(repository);
    await service.create({ name: '  Cozinha  ', locationType: 'CONSUMPTION' });
    await service.update(ids.entity, { locationType: 'STOCK', name: ' Depósito ' });
    await service.search({ page: 3, pageSize: 50, locationType: 'STOCK' });

    expect(repository.created).toEqual({
      name: 'Cozinha',
      description: null,
      locationType: 'CONSUMPTION',
    });
    expect(repository.updated).toEqual({ locationType: 'STOCK', name: 'Depósito' });
    expect(repository.searched).toEqual({ page: 3, pageSize: 50, locationType: 'STOCK' });
    expect(() => service.search({ pageSize: 101 })).toThrow(/entre 1 e 100/i);
  });
});

describe('serviço de produtos', () => {
  it('normaliza cadastro e nunca encaminha saldo ao repositório', async () => {
    const repository = new ProductRepositoryFixture();
    const service = new ProductService(repository);
    const input = {
      name: '  Arroz   branco ',
      sku: ' arroz-001 ',
      ean: '7894900011517',
      categoryId: ids.category,
      productType: 'RAW',
      unit: 'KG',
      minimumQuantity: '2.5',
      balance: '999.000',
    } satisfies CreateProductInput & { balance: string };

    await service.create(input);
    expect(repository.created).toEqual({
      name: 'Arroz branco',
      sku: 'ARROZ-001',
      ean: '7894900011517',
      categoryId: ids.category,
      productType: 'RAW',
      unit: 'KG',
      minimumQuantity: '2.500',
    });
    expect(repository.created).not.toHaveProperty('balance');
  });

  it('edita apenas cadastro, pesquisa com filtros e alterna estado ativo', async () => {
    const repository = new ProductRepositoryFixture();
    const service = new ProductService(repository);
    await service.update(ids.entity, { name: ' Arroz integral ', minimumQuantity: '3' });
    await service.search({
      page: 4,
      pageSize: 20,
      search: ' arroz ',
      categoryId: ids.category,
      productType: 'RAW',
      unit: 'KG',
      isActive: false,
    });
    await service.deactivate(ids.entity);
    await service.reactivate(ids.entity);

    expect(repository.updated).toEqual({ name: 'Arroz integral', minimumQuantity: '3.000' });
    expect(repository.searched).toEqual({
      page: 4,
      pageSize: 20,
      search: 'arroz',
      categoryId: ids.category,
      productType: 'RAW',
      unit: 'KG',
      isActive: false,
    });
    expect(repository.activeValues).toEqual([false, true]);
    expect('delete' in service).toBe(false);
  });

  it('rejeita EAN, quantidade, página e edição vazia inválidos', () => {
    const service = new ProductService(new ProductRepositoryFixture());
    expect(() =>
      service.create({
        name: 'Produto',
        sku: 'SKU',
        ean: '12345678',
        categoryId: ids.category,
        productType: 'RAW',
        unit: 'UN',
      }),
    ).toThrow(/EAN inválido/i);
    expect(() =>
      service.create({
        name: 'Produto',
        sku: 'SKU',
        categoryId: ids.category,
        productType: 'RAW',
        unit: 'UN',
        minimumQuantity: '-1',
      }),
    ).toThrow(/NUMERIC\(18,3\)/i);
    expect(() => service.search({ page: 0 })).toThrow(/inteiro positivo/i);
    expect(() => service.update(ids.entity, {})).toThrow(/ao menos um campo/i);
  });
});
