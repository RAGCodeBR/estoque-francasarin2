import { describe, expect, it } from 'vitest';

import {
  createIdempotencyKey,
  formatDateTime,
  formatDecimal,
} from '../../../src/app/components/operational/operational-format';
import { buildCurrentStockQuery } from '../../../src/app/features/stock/stock-query';

describe('contratos das telas operacionais', () => {
  it('transforma os filtros de estoque em consulta paginada para o backend', () => {
    expect(
      buildCurrentStockQuery({
        search: 'arroz',
        productType: 'RAW',
        categoryId: 'a1500000-0000-4000-8000-000000000003',
        situation: 'BELOW_MINIMUM',
        page: 3,
        pageSize: 25,
      }),
    ).toEqual({
      search: 'arroz',
      productType: 'RAW',
      categoryId: 'a1500000-0000-4000-8000-000000000003',
      situation: 'BELOW_MINIMUM',
      isActive: true,
      page: 3,
      pageSize: 25,
    });
  });

  it('não inventa filtros vazios e mantém RAW/FRACTIONATED na mesma consulta base', () => {
    expect(
      buildCurrentStockQuery({
        search: '',
        productType: '',
        categoryId: '',
        situation: '',
        page: 1,
        pageSize: 25,
      }),
    ).toEqual({ isActive: true, page: 1, pageSize: 25 });
  });

  it('formata decimais somente para apresentação e cria chaves idempotentes únicas', () => {
    expect(formatDecimal('12.500', 'KG')).toBe('12,500 KG');
    expect(formatDateTime('2026-08-20T20:00:00.000Z')).toMatch(/20\/08\/2026/);
    const first = createIdempotencyKey('loss');
    const second = createIdempotencyKey('loss');
    expect(first).toMatch(/^loss:[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });
});
