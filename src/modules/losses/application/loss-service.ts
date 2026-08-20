import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../../utils/domain-values';
import { normalizeStockQuantity } from '../../inventory';
import type { RegisterLossInput, StockLossReport } from '../domain/types';
import type { LossRepository } from '../ports/loss-repository';

export class LossService {
  constructor(private readonly repository: LossRepository) {}

  async register(input: RegisterLossInput): Promise<StockLossReport> {
    const reason = normalizeRequiredText(input.reason, 'Motivo');
    if (reason.length > 500) throw new Error('Motivo deve possuir no máximo 500 caracteres.');

    const notes = normalizeOptionalText(input.notes);
    if (notes !== null && notes.length > 2000) {
      throw new Error('Observação deve possuir no máximo 2000 caracteres.');
    }

    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, 'Chave de idempotência');
    if (idempotencyKey.length > 200) {
      throw new Error('Chave de idempotência deve possuir no máximo 200 caracteres.');
    }

    return await this.repository.register({
      productId: assertUuid(input.productId, 'ID do produto'),
      quantity: normalizeStockQuantity(input.quantity),
      locationId: assertUuid(input.locationId, 'ID do local'),
      reason,
      ...(notes === null ? {} : { notes }),
      idempotencyKey,
    });
  }
}
