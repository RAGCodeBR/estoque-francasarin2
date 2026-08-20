import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../../utils/domain-values';
import type {
  CreateInventoryCountInput,
  InventoryCountItemInput,
  InventoryCountReport,
  SaveInventoryCountItemsInput,
} from '../domain/inventory-count-types';
import type { InventoryCountRepository } from '../ports/inventory-count-repository';

const NONNEGATIVE_NUMERIC_18_3 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/;
const MAX_INVENTORY_ITEMS = 5000;

function normalizeCountedQuantity(value: string): string {
  const normalized = value.trim();
  if (!NONNEGATIVE_NUMERIC_18_3.test(normalized)) {
    throw new Error('Contagem deve ser um NUMERIC(18,3) não negativo.');
  }
  const [integer = '0', fraction = ''] = normalized.split('.');
  return `${integer}.${fraction.padEnd(3, '0')}`;
}

function normalizeItem(item: InventoryCountItemInput): InventoryCountItemInput {
  return {
    productId: assertUuid(item.productId, 'ID do produto'),
    countedQuantity: normalizeCountedQuantity(item.countedQuantity),
  };
}

export class InventoryCountService {
  constructor(private readonly repository: InventoryCountRepository) {}

  async create(input: CreateInventoryCountInput): Promise<InventoryCountReport> {
    const reference = normalizeOptionalText(input.reference);
    const notes = normalizeOptionalText(input.notes);
    if (reference !== null && reference.length > 200) {
      throw new Error('Referência deve possuir no máximo 200 caracteres.');
    }
    if (notes !== null && notes.length > 2000) {
      throw new Error('Observação deve possuir no máximo 2000 caracteres.');
    }

    return await this.repository.create({
      locationId: assertUuid(input.locationId, 'ID do local'),
      ...(reference === null ? {} : { reference }),
      ...(notes === null ? {} : { notes }),
    });
  }

  async open(inventoryCountId: string): Promise<InventoryCountReport> {
    return await this.repository.open(assertUuid(inventoryCountId, 'ID do inventário'));
  }

  async saveItems(input: SaveInventoryCountItemsInput): Promise<InventoryCountReport> {
    if (input.items.length < 1 || input.items.length > MAX_INVENTORY_ITEMS) {
      throw new Error(`O inventário deve receber entre 1 e ${String(MAX_INVENTORY_ITEMS)} itens.`);
    }

    const items = input.items.map(normalizeItem);
    const uniqueProducts = new Set(items.map(({ productId }) => productId));
    if (uniqueProducts.size !== items.length) {
      throw new Error('O mesmo produto não pode aparecer duas vezes no envio.');
    }

    return await this.repository.saveItems(
      assertUuid(input.inventoryCountId, 'ID do inventário'),
      items,
      input.replace ?? false,
    );
  }

  async review(inventoryCountId: string): Promise<InventoryCountReport> {
    return await this.repository.review(assertUuid(inventoryCountId, 'ID do inventário'));
  }

  async confirm(inventoryCountId: string, idempotencyKey: string): Promise<InventoryCountReport> {
    const normalizedKey = normalizeRequiredText(idempotencyKey, 'Chave de idempotência');
    if (normalizedKey.length > 200) {
      throw new Error('Chave de idempotência deve possuir no máximo 200 caracteres.');
    }
    return await this.repository.confirm(
      assertUuid(inventoryCountId, 'ID do inventário'),
      normalizedKey,
    );
  }
}
