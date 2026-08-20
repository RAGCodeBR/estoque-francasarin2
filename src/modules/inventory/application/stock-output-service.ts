import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../../utils/domain-values';
import type {
  StockOutputBatchInput,
  StockOutputInput,
  StockOutputItemInput,
  StockOutputReport,
} from '../domain/types';
import { normalizeStockQuantity } from '../domain/validation';
import type { StockOutputRepository } from '../ports/stock-output-repository';

const MAX_BATCH_ITEMS = 100;

function normalizeItem(item: StockOutputItemInput): StockOutputItemInput {
  return {
    productId: assertUuid(item.productId, 'ID do produto'),
    quantity: normalizeStockQuantity(item.quantity),
  };
}

function normalizeBatch(input: StockOutputBatchInput): StockOutputBatchInput {
  if (input.items.length < 1 || input.items.length > MAX_BATCH_ITEMS) {
    throw new Error(`A saída deve possuir entre 1 e ${String(MAX_BATCH_ITEMS)} itens.`);
  }

  const sourceLocationId = assertUuid(input.sourceLocationId, 'ID do local de origem');
  const destinationLocationId = assertUuid(input.destinationLocationId, 'ID do local de destino');
  if (sourceLocationId === destinationLocationId) {
    throw new Error('Os locais de origem e destino devem ser diferentes.');
  }

  const idempotencyKey = normalizeRequiredText(input.idempotencyKey, 'Chave de idempotência');
  if (idempotencyKey.length > 200) {
    throw new Error('Chave de idempotência deve possuir no máximo 200 caracteres.');
  }

  const reason = normalizeOptionalText(input.reason);
  return {
    sourceLocationId,
    destinationLocationId,
    idempotencyKey,
    ...(reason === null ? {} : { reason }),
    items: input.items.map(normalizeItem),
  };
}

export class StockOutputService {
  constructor(private readonly repository: StockOutputRepository) {}

  async confirm(input: StockOutputInput): Promise<StockOutputReport> {
    return await this.confirmBatch({
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      idempotencyKey: input.idempotencyKey,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      items: [{ productId: input.productId, quantity: input.quantity }],
    });
  }

  async confirmBatch(input: StockOutputBatchInput): Promise<StockOutputReport> {
    return await this.repository.consumeBatch(normalizeBatch(input));
  }
}
