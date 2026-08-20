import type {
  CreateInventoryCountInput,
  InventoryCountItemInput,
  InventoryCountReport,
} from '../domain/inventory-count-types';

export interface InventoryCountRepository {
  create(input: CreateInventoryCountInput): Promise<InventoryCountReport>;
  open(inventoryCountId: string): Promise<InventoryCountReport>;
  saveItems(
    inventoryCountId: string,
    items: readonly InventoryCountItemInput[],
    replace: boolean,
  ): Promise<InventoryCountReport>;
  review(inventoryCountId: string): Promise<InventoryCountReport>;
  confirm(inventoryCountId: string, idempotencyKey: string): Promise<InventoryCountReport>;
}
