import { describe, expect, it } from 'vitest';

import {
  formatDashboardQuantity,
  movementLabel,
  movementSummary,
  quantitySummary,
} from '../../../src/app/features/dashboard/dashboard-view';

describe('formatação do dashboard', () => {
  it('mantém KG e UN separados ao resumir quantidades', () => {
    expect(
      quantitySummary([
        { quantity: '12.500', unit: 'KG' },
        { quantity: '8.000', unit: 'UN' },
      ]),
    ).toBe('12,5 KG · 8 UN');
    expect(formatDashboardQuantity('0.125', 'KG')).toBe('0,125 KG');
  });

  it('resume contagem e quantidades sem somar unidades incompatíveis', () => {
    expect(
      movementSummary({
        movementCount: 3,
        quantities: [
          { quantity: '2.000', unit: 'KG' },
          { quantity: '5.000', unit: 'UN' },
        ],
      }),
    ).toBe('3 movimentações · 2 KG · 5 UN');
    expect(movementSummary({ movementCount: 0, quantities: [] })).toBe(
      '0 movimentações · Sem quantidade no período',
    );
  });

  it('traduz todos os tipos de movimentação exibidos', () => {
    expect(movementLabel('PURCHASE_ENTRY')).toBe('Entrada por compra');
    expect(movementLabel('MIGRATION_OPENING_BALANCE')).toBe('Saldo inicial migrado');
  });
});
