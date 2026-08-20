import { assertUuid, normalizeRequiredText } from '../../../utils/domain-values';
import type { StockAdjustmentInput, StockAdjustmentReport } from '../domain/adjustment-types';
import type { StockAdjustmentRepository } from '../ports/stock-adjustment-repository';

const SIGNED_NUMERIC_18_3 = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/;

function normalizeDelta(value: string): string {
  const normalized = value.trim();
  if (!SIGNED_NUMERIC_18_3.test(normalized)) {
    throw new Error('Diferença deve ser um NUMERIC(18,3) assinado.');
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  const result = `${negative ? '-' : ''}${integer}.${fraction.padEnd(3, '0')}`;
  if (result === '0.000' || result === '-0.000') {
    throw new Error('Diferença de ajuste não pode ser zero.');
  }
  return result;
}

export class StockAdjustmentService {
  constructor(private readonly repository: StockAdjustmentRepository) {}

  async adjust(input: StockAdjustmentInput): Promise<StockAdjustmentReport> {
    const reason = normalizeRequiredText(input.reason, 'Motivo');
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, 'Chave de idempotência');
    if (idempotencyKey.length > 200) {
      throw new Error('Chave de idempotência deve possuir no máximo 200 caracteres.');
    }

    return await this.repository.adjust({
      productId: assertUuid(input.productId, 'ID do produto'),
      quantityDelta: normalizeDelta(input.quantityDelta),
      locationId: assertUuid(input.locationId, 'ID do local'),
      reason,
      idempotencyKey,
      ...(input.referenceMovementId === undefined
        ? {}
        : {
            referenceMovementId: assertUuid(
              input.referenceMovementId,
              'ID do movimento de referência',
            ),
          }),
    });
  }
}
