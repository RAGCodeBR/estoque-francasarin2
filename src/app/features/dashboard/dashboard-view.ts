import type {
  DashboardMovementIndicator,
  DashboardMovementType,
  DashboardQuantity,
  DashboardUnit,
} from '../../../modules/dashboard';

const movementLabels: Readonly<Record<DashboardMovementType, string>> = {
  PURCHASE_ENTRY: 'Entrada por compra',
  CONSUMPTION_EXIT: 'Saída para consumo',
  LOSS: 'Perda',
  ADJUSTMENT_POSITIVE: 'Ajuste positivo',
  ADJUSTMENT_NEGATIVE: 'Ajuste negativo',
  TRANSFER: 'Transferência',
  FRACTIONATION: 'Fracionamento',
  MIGRATION_OPENING_BALANCE: 'Saldo inicial migrado',
};

export function movementLabel(type: DashboardMovementType): string {
  return movementLabels[type];
}

export function formatDashboardQuantity(quantity: string, unit: DashboardUnit): string {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) return `${quantity} ${unit}`;
  return `${new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(parsed)} ${unit}`;
}

export function quantitySummary(quantities: readonly DashboardQuantity[]): string {
  if (quantities.length === 0) return 'Sem quantidade no período';
  return quantities
    .map(({ quantity, unit }) => formatDashboardQuantity(quantity, unit))
    .join(' · ');
}

export function movementSummary(indicator: DashboardMovementIndicator): string {
  const label = indicator.movementCount === 1 ? 'movimentação' : 'movimentações';
  return `${indicator.movementCount.toLocaleString('pt-BR')} ${label} · ${quantitySummary(indicator.quantities)}`;
}

export function formatDashboardDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function formatDashboardDate(value: string, compact = false): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: compact ? '2-digit' : 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}
