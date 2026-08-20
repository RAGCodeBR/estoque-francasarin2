import { describe, expect, it } from 'vitest';

import { StockOutputService } from '../../../src/modules/inventory';
import type {
  StockOutputBatchInput,
  StockOutputReport,
  StockOutputRepository,
} from '../../../src/modules/inventory';

const ids = {
  product: '10000000-0000-4000-8000-000000000001',
  source: '20000000-0000-4000-8000-000000000001',
  destination: '30000000-0000-4000-8000-000000000001',
  actor: '40000000-0000-4000-8000-000000000001',
  batch: '50000000-0000-4000-8000-000000000001',
  movement: '60000000-0000-4000-8000-000000000001',
} as const;

class RepositoryStub implements StockOutputRepository {
  readonly calls: StockOutputBatchInput[] = [];

  async consumeBatch(input: StockOutputBatchInput): Promise<StockOutputReport> {
    this.calls.push(input);
    return Promise.resolve({
      batchId: ids.batch,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? 'Saída para local de consumo',
      createdAt: '2026-08-20T12:00:00.000Z',
      createdBy: ids.actor,
      movementCount: input.items.length,
      applied: true,
      items: input.items.map((item, index) => ({
        lineNumber: index + 1,
        movementId: ids.movement,
        productId: item.productId,
        quantity: item.quantity,
        unit: 'KG',
        newBalance: '8.500',
        destinationLocationId: input.destinationLocationId,
        createdAt: '2026-08-20T12:00:00.000Z',
        createdBy: ids.actor,
      })),
    });
  }
}

describe('StockOutputService', () => {
  it('confirma uma saída pelo mesmo contrato atômico do lote', async () => {
    const repository = new RepositoryStub();
    const service = new StockOutputService(repository);

    const result = await service.confirm({
      productId: ids.product.toUpperCase(),
      quantity: ' 1.5 ',
      sourceLocationId: ids.source.toUpperCase(),
      destinationLocationId: ids.destination.toUpperCase(),
      idempotencyKey: ' saída:cozinha:1 ',
      reason: '  Preparo   diário  ',
    });

    expect(result.applied).toBe(true);
    expect(repository.calls).toEqual([
      {
        sourceLocationId: ids.source,
        destinationLocationId: ids.destination,
        idempotencyKey: 'saída:cozinha:1',
        reason: 'Preparo diário',
        items: [{ productId: ids.product, quantity: '1.500' }],
      },
    ]);
  });

  it('normaliza várias quantidades sem utilizar número de ponto flutuante', async () => {
    const repository = new RepositoryStub();
    const service = new StockOutputService(repository);

    await service.confirmBatch({
      sourceLocationId: ids.source,
      destinationLocationId: ids.destination,
      idempotencyKey: 'batch:1',
      items: [
        { productId: ids.product, quantity: '2' },
        { productId: ids.movement, quantity: '0.125' },
      ],
    });

    expect(repository.calls[0]?.items).toEqual([
      { productId: ids.product, quantity: '2.000' },
      { productId: ids.movement, quantity: '0.125' },
    ]);
  });

  it.each(['0', '-1', '1.0001', '1,5', 'NaN'])(
    'rejeita quantidade inválida %s antes de chamar o banco',
    async (quantity) => {
      const repository = new RepositoryStub();
      const service = new StockOutputService(repository);

      await expect(
        service.confirm({
          productId: ids.product,
          quantity,
          sourceLocationId: ids.source,
          destinationLocationId: ids.destination,
          idempotencyKey: 'invalid:quantity',
        }),
      ).rejects.toThrow(/Quantidade/);
      expect(repository.calls).toEqual([]);
    },
  );

  it('rejeita lote vazio, lote acima do limite e locais iguais', async () => {
    const repository = new RepositoryStub();
    const service = new StockOutputService(repository);
    const base = {
      sourceLocationId: ids.source,
      destinationLocationId: ids.destination,
      idempotencyKey: 'invalid:batch',
    } as const;

    await expect(service.confirmBatch({ ...base, items: [] })).rejects.toThrow(/entre 1 e 100/);
    await expect(
      service.confirmBatch({
        ...base,
        items: Array.from({ length: 101 }, () => ({
          productId: ids.product,
          quantity: '1',
        })),
      }),
    ).rejects.toThrow(/entre 1 e 100/);
    await expect(
      service.confirmBatch({
        ...base,
        destinationLocationId: ids.source,
        items: [
          {
            productId: ids.product,
            quantity: '1',
          },
        ],
      }),
    ).rejects.toThrow(/devem ser diferentes/);
    expect(repository.calls).toEqual([]);
  });
});
