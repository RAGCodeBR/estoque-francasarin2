import { describe, expect, it } from 'vitest';

import {
  InventoryCountService,
  StockAdjustmentService,
  type CreateInventoryCountInput,
  type InventoryCountItemInput,
  type InventoryCountReport,
  type InventoryCountRepository,
  type StockAdjustmentInput,
  type StockAdjustmentReport,
  type StockAdjustmentRepository,
} from '../../../src/modules/inventory';
import {
  LossService,
  type LossRepository,
  type RegisterLossInput,
  type StockLossReport,
} from '../../../src/modules/losses';

const ids = {
  product: '81000000-0000-4000-8000-000000000001',
  productB: '81000000-0000-4000-8000-000000000002',
  location: '82000000-0000-4000-8000-000000000001',
  count: '83000000-0000-4000-8000-000000000001',
  actor: '84000000-0000-4000-8000-000000000001',
  movement: '85000000-0000-4000-8000-000000000001',
  loss: '86000000-0000-4000-8000-000000000001',
} as const;

function inventoryReport(status: InventoryCountReport['status']): InventoryCountReport {
  return {
    inventoryCountId: ids.count,
    locationId: ids.location,
    status,
    reference: null,
    notes: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    createdBy: ids.actor,
    startedAt: status === 'DRAFT' ? null : '2026-08-20T12:01:00.000Z',
    startedBy: status === 'DRAFT' ? null : ids.actor,
    reviewedAt: status === 'REVIEW' || status === 'CONFIRMED' ? '2026-08-20T12:02:00.000Z' : null,
    reviewedBy: status === 'REVIEW' || status === 'CONFIRMED' ? ids.actor : null,
    confirmedAt: status === 'CONFIRMED' ? '2026-08-20T12:03:00.000Z' : null,
    confirmedBy: status === 'CONFIRMED' ? ids.actor : null,
    confirmationIdempotencyKey: status === 'CONFIRMED' ? 'inventory:1' : null,
    itemCount: 0,
    positiveAdjustments: 0,
    negativeAdjustments: 0,
    unchangedItems: 0,
    movementsCreated: 0,
    applied: true,
    items: [],
  };
}

class InventoryRepositoryStub implements InventoryCountRepository {
  readonly calls: unknown[][] = [];

  async create(input: CreateInventoryCountInput): Promise<InventoryCountReport> {
    this.calls.push(['create', input]);
    return Promise.resolve(inventoryReport('DRAFT'));
  }

  async open(inventoryCountId: string): Promise<InventoryCountReport> {
    this.calls.push(['open', inventoryCountId]);
    return Promise.resolve(inventoryReport('COUNTING'));
  }

  async saveItems(
    inventoryCountId: string,
    items: readonly InventoryCountItemInput[],
    replace: boolean,
  ): Promise<InventoryCountReport> {
    this.calls.push(['saveItems', inventoryCountId, items, replace]);
    return Promise.resolve(inventoryReport('COUNTING'));
  }

  async review(inventoryCountId: string): Promise<InventoryCountReport> {
    this.calls.push(['review', inventoryCountId]);
    return Promise.resolve(inventoryReport('REVIEW'));
  }

  async confirm(inventoryCountId: string, idempotencyKey: string): Promise<InventoryCountReport> {
    this.calls.push(['confirm', inventoryCountId, idempotencyKey]);
    return Promise.resolve(inventoryReport('CONFIRMED'));
  }
}

class LossRepositoryStub implements LossRepository {
  readonly calls: RegisterLossInput[] = [];

  async register(input: RegisterLossInput): Promise<StockLossReport> {
    this.calls.push(input);
    return Promise.resolve({
      lossId: ids.loss,
      movementId: ids.movement,
      productId: input.productId,
      quantity: input.quantity,
      unit: 'KG',
      locationId: input.locationId,
      reason: input.reason,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      createdAt: '2026-08-20T12:00:00.000Z',
      createdBy: ids.actor,
      newBalance: '7.500',
      applied: true,
    });
  }
}

class AdjustmentRepositoryStub implements StockAdjustmentRepository {
  readonly calls: StockAdjustmentInput[] = [];

  async adjust(input: StockAdjustmentInput): Promise<StockAdjustmentReport> {
    this.calls.push(input);
    return Promise.resolve({ movementId: ids.movement, newBalance: '50.000', applied: true });
  }
}

describe('LossService', () => {
  it('normaliza a perda preservando quantidade decimal, motivo e observação', async () => {
    const repository = new LossRepositoryStub();
    const service = new LossService(repository);

    await service.register({
      productId: ids.product.toUpperCase(),
      quantity: ' 2.5 ',
      locationId: ids.location.toUpperCase(),
      reason: '  Validade   expirada ',
      notes: '  Descarte   acompanhado ',
      idempotencyKey: ' perda:1 ',
    });

    expect(repository.calls).toEqual([
      {
        productId: ids.product,
        quantity: '2.500',
        locationId: ids.location,
        reason: 'Validade expirada',
        notes: 'Descarte acompanhado',
        idempotencyKey: 'perda:1',
      },
    ]);
  });

  it.each(['0', '-1', '1.0001'])('rejeita quantidade de perda inválida %s', async (quantity) => {
    const repository = new LossRepositoryStub();
    const service = new LossService(repository);
    await expect(
      service.register({
        productId: ids.product,
        quantity,
        locationId: ids.location,
        reason: 'Motivo',
        idempotencyKey: 'loss:invalid',
      }),
    ).rejects.toThrow(/Quantidade/);
    expect(repository.calls).toEqual([]);
  });
});

describe('InventoryCountService', () => {
  it('normaliza criação e todas as transições sem expor escrita de saldo', async () => {
    const repository = new InventoryRepositoryStub();
    const service = new InventoryCountService(repository);

    await service.create({
      locationId: ids.location.toUpperCase(),
      reference: ' Inventário   mensal ',
      notes: ' Contagem   completa ',
    });
    await service.open(ids.count.toUpperCase());
    await service.saveItems({
      inventoryCountId: ids.count.toUpperCase(),
      replace: true,
      items: [
        { productId: ids.product.toUpperCase(), countedQuantity: '50' },
        { productId: ids.productB, countedQuantity: '0.125' },
      ],
    });
    await service.review(ids.count);
    await service.confirm(ids.count, ' inventário:confirmar:1 ');

    expect(repository.calls).toEqual([
      [
        'create',
        {
          locationId: ids.location,
          reference: 'Inventário mensal',
          notes: 'Contagem completa',
        },
      ],
      ['open', ids.count],
      [
        'saveItems',
        ids.count,
        [
          { productId: ids.product, countedQuantity: '50.000' },
          { productId: ids.productB, countedQuantity: '0.125' },
        ],
        true,
      ],
      ['review', ids.count],
      ['confirm', ids.count, 'inventário:confirmar:1'],
    ]);
  });

  it('aceita contagem física zero e rejeita duplicidade, negativo e precisão excessiva', async () => {
    const repository = new InventoryRepositoryStub();
    const service = new InventoryCountService(repository);

    await service.saveItems({
      inventoryCountId: ids.count,
      items: [{ productId: ids.product, countedQuantity: '0' }],
    });
    expect(repository.calls[0]).toEqual([
      'saveItems',
      ids.count,
      [{ productId: ids.product, countedQuantity: '0.000' }],
      false,
    ]);

    await expect(
      service.saveItems({
        inventoryCountId: ids.count,
        items: [
          { productId: ids.product, countedQuantity: '1' },
          { productId: ids.product.toUpperCase(), countedQuantity: '2' },
        ],
      }),
    ).rejects.toThrow(/duas vezes/);
    await expect(
      service.saveItems({
        inventoryCountId: ids.count,
        items: [{ productId: ids.product, countedQuantity: '-1' }],
      }),
    ).rejects.toThrow(/não negativo/);
    await expect(
      service.saveItems({
        inventoryCountId: ids.count,
        items: [{ productId: ids.product, countedQuantity: '1.0001' }],
      }),
    ).rejects.toThrow(/NUMERIC/);
  });
});

describe('StockAdjustmentService', () => {
  it.each([
    [' 3 ', '3.000'],
    [' -3 ', '-3.000'],
  ])(
    'normaliza diferença assinada %s e chama somente o motor transacional',
    async (input, expected) => {
      const repository = new AdjustmentRepositoryStub();
      const service = new StockAdjustmentService(repository);

      await service.adjust({
        productId: ids.product,
        quantityDelta: input,
        locationId: ids.location,
        reason: ' Contagem   física ',
        idempotencyKey: ' adjustment:1 ',
      });

      expect(repository.calls).toEqual([
        {
          productId: ids.product,
          quantityDelta: expected,
          locationId: ids.location,
          reason: 'Contagem física',
          idempotencyKey: 'adjustment:1',
        },
      ]);
    },
  );

  it.each(['0', '-0', '1.0001', '1,5'])(
    'rejeita diferença inválida %s antes do repositório',
    async (quantityDelta) => {
      const repository = new AdjustmentRepositoryStub();
      const service = new StockAdjustmentService(repository);
      await expect(
        service.adjust({
          productId: ids.product,
          quantityDelta,
          locationId: ids.location,
          reason: 'Contagem física',
          idempotencyKey: 'adjustment:invalid',
        }),
      ).rejects.toThrow(/Diferença/);
      expect(repository.calls).toEqual([]);
    },
  );
});
