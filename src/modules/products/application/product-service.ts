import { resolvePageRequest } from '../../../types/pagination';
import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeSearch,
} from '../../../utils/domain-values';
import type {
  CreateProductInput,
  Product,
  ProductPage,
  ProductSearch,
  UpdateProductInput,
} from '../domain/types';
import {
  assertProductType,
  assertUnitType,
  isValidEan,
  normalizeMinimumQuantity,
  normalizeSku,
} from '../domain/validation';
import type { ProductRepository } from '../ports/product-repository';

function normalizeEan(value: string | null | undefined): string | null {
  const ean = normalizeOptionalText(value);
  if (ean !== null && !isValidEan(ean)) throw new Error('EAN inválido.');
  return ean;
}

export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  create(input: CreateProductInput): Promise<Product> {
    return this.repository.create({
      name: normalizeRequiredText(input.name, 'Nome do produto'),
      sku: normalizeSku(input.sku),
      ean: normalizeEan(input.ean),
      categoryId: assertUuid(input.categoryId, 'ID da categoria'),
      productType: assertProductType(input.productType),
      unit: assertUnitType(input.unit),
      minimumQuantity: normalizeMinimumQuantity(input.minimumQuantity),
    });
  }

  getById(id: string): Promise<Product | null> {
    return this.repository.getById(assertUuid(id, 'ID do produto'));
  }

  search(query: ProductSearch = {}): Promise<ProductPage> {
    const page = resolvePageRequest(query);
    const search = normalizeSearch(query.search);
    return this.repository.search({
      ...page,
      ...(search ? { search } : {}),
      ...(query.categoryId ? { categoryId: assertUuid(query.categoryId, 'ID da categoria') } : {}),
      ...(query.productType ? { productType: assertProductType(query.productType) } : {}),
      ...(query.unit ? { unit: assertUnitType(query.unit) } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    });
  }

  update(id: string, input: UpdateProductInput): Promise<Product> {
    const record = {
      ...(input.name === undefined
        ? {}
        : { name: normalizeRequiredText(input.name, 'Nome do produto') }),
      ...(input.sku === undefined ? {} : { sku: normalizeSku(input.sku) }),
      ...(input.ean === undefined ? {} : { ean: normalizeEan(input.ean) }),
      ...(input.categoryId === undefined
        ? {}
        : { categoryId: assertUuid(input.categoryId, 'ID da categoria') }),
      ...(input.productType === undefined
        ? {}
        : { productType: assertProductType(input.productType) }),
      ...(input.unit === undefined ? {} : { unit: assertUnitType(input.unit) }),
      ...(input.minimumQuantity === undefined
        ? {}
        : { minimumQuantity: normalizeMinimumQuantity(input.minimumQuantity) }),
    };
    if (Object.keys(record).length === 0) throw new Error('Informe ao menos um campo para edição.');
    return this.repository.update(assertUuid(id, 'ID do produto'), record);
  }

  deactivate(id: string): Promise<Product> {
    return this.repository.setActive(assertUuid(id, 'ID do produto'), false);
  }

  reactivate(id: string): Promise<Product> {
    return this.repository.setActive(assertUuid(id, 'ID do produto'), true);
  }
}
