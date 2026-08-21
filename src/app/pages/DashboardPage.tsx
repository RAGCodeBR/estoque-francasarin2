import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import {
  DASHBOARD_PERIODS,
  DashboardService,
  SupabaseDashboardRepository,
  type DashboardPeriod,
  type DashboardQuantity,
  type DashboardUnit,
  type InventoryDashboard,
} from '../../modules/dashboard';
import { EmptyState } from '../components/feedback/EmptyState';
import { Icon } from '../components/ui/Icon';
import {
  formatDashboardDate,
  formatDashboardDateTime,
  formatDashboardQuantity,
  movementLabel,
  movementSummary,
} from '../features/dashboard/dashboard-view';

interface RankingItem extends DashboardQuantity {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
}

const unitLabels: Readonly<Record<DashboardUnit, string>> = { KG: 'Quilogramas', UN: 'Unidades' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível carregar o dashboard.';
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  to,
}: {
  readonly label: string;
  readonly value: number;
  readonly detail: string;
  readonly tone?: 'neutral' | 'warning' | 'danger' | 'success';
  readonly to?: string;
}) {
  const content = (
    <>
      <span className="dashboard-metric__label">{label}</span>
      <strong>{value.toLocaleString('pt-BR')}</strong>
      <small>{detail}</small>
    </>
  );
  return to ? (
    <Link className={`dashboard-metric dashboard-metric--${tone}`} to={to}>
      {content}
    </Link>
  ) : (
    <article className={`dashboard-metric dashboard-metric--${tone}`}>{content}</article>
  );
}

function TrendChart({ dashboard, unit }: { dashboard: InventoryDashboard; unit: DashboardUnit }) {
  const points = dashboard.consumptionTrend.filter((point) => point.unit === unit);
  const maximum = Math.max(...points.map((point) => Number(point.quantity)), 0);

  return (
    <div className="dashboard-trend" aria-label={`Consumo em ${unit}`}>
      <div className="dashboard-chart__unit">
        <strong>{unitLabels[unit]}</strong>
        <span>{unit}</span>
      </div>
      <div className="dashboard-trend__plot">
        {points.map((point, index) => {
          const value = Number(point.quantity);
          const height = maximum > 0 ? Math.max((value / maximum) * 100, value > 0 ? 5 : 0) : 0;
          const showLabel =
            points.length <= 14 || index === 0 || index === points.length - 1 || index % 7 === 0;
          return (
            <div className="dashboard-trend__point" key={`${unit}:${point.periodStart}`}>
              <span className="dashboard-trend__value">
                {value > 0 ? formatDashboardQuantity(point.quantity, unit) : ''}
              </span>
              <span
                aria-label={`${formatDashboardDate(point.periodStart)}: ${formatDashboardQuantity(point.quantity, unit)}`}
                className="dashboard-trend__bar"
                style={{ height: `${String(height)}%` }}
                title={`${formatDashboardDate(point.periodStart)} · ${formatDashboardQuantity(point.quantity, unit)}`}
              />
              <small>{showLabel ? formatDashboardDate(point.periodStart, true) : ''}</small>
            </div>
          );
        })}
      </div>
      {maximum === 0 ? (
        <p className="dashboard-chart__empty">Sem consumo em {unit} no período.</p>
      ) : null}
    </div>
  );
}

function RankingChart({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly RankingItem[];
}) {
  return (
    <section className="page-surface dashboard-ranking">
      <div className="dashboard-card-heading">
        <div>
          <span>ANÁLISE</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="dashboard-ranking__units">
        {(['KG', 'UN'] as const).map((unit) => {
          const unitItems = items.filter((item) => item.unit === unit);
          const maximum = Math.max(...unitItems.map((item) => Number(item.quantity)), 0);
          return (
            <div className="dashboard-ranking__unit" key={unit}>
              <div className="dashboard-chart__unit">
                <strong>{unitLabels[unit]}</strong>
                <span>{unit}</span>
              </div>
              {unitItems.length === 0 ? (
                <p className="dashboard-chart__empty">Sem dados em {unit}.</p>
              ) : (
                <ol>
                  {unitItems.map((item) => (
                    <li key={`${unit}:${item.id}`}>
                      <div className="dashboard-ranking__label">
                        <span>
                          <strong>{item.label}</strong>
                          {item.detail ? <small>{item.detail}</small> : null}
                        </span>
                        <b>{formatDashboardQuantity(item.quantity, unit)}</b>
                      </div>
                      <span className="dashboard-ranking__track">
                        <span
                          style={{
                            width: `${String((Number(item.quantity) / maximum) * 100)}%`,
                          }}
                        />
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const service = useMemo(() => new DashboardService(new SupabaseDashboardRepository()), []);
  const [period, setPeriod] = useState<DashboardPeriod>(30);
  const [dashboard, setDashboard] = useState<InventoryDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void service
      .load({ periodDays: period, recentLimit: 8 })
      .then((result) => {
        if (active) setDashboard(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, requestVersion, service]);

  const topConsumed: readonly RankingItem[] =
    dashboard?.topConsumed.map((item) => ({
      ...item,
      id: item.productId,
      label: item.productName,
      detail: item.sku,
    })) ?? [];
  const lossesByCategory: readonly RankingItem[] =
    dashboard?.lossesByCategory.map((item) => ({
      ...item,
      id: item.categoryId ?? 'none',
      label: item.categoryName,
    })) ?? [];
  const consumptionByLocation: readonly RankingItem[] =
    dashboard?.consumptionByLocation.map((item) => ({
      ...item,
      id: item.locationId ?? 'none',
      label: item.locationName,
    })) ?? [];

  return (
    <div className="page-stack">
      <header className="page-heading page-heading--dashboard">
        <div>
          <span className="page-heading__eyebrow">VISÃO GERAL</span>
          <h1>Dashboard do estoque</h1>
          <p>
            Indicadores operacionais calculados no banco, com quantidades separadas por unidade.
          </p>
        </div>
        <div className="dashboard-period" aria-label="Período do dashboard">
          {DASHBOARD_PERIODS.map((days) => (
            <button
              aria-pressed={period === days}
              className={period === days ? 'is-active' : ''}
              disabled={loading}
              key={days}
              onClick={() => {
                if (days === period) return;
                setLoading(true);
                setError(null);
                setDashboard(null);
                setPeriod(days);
              }}
              type="button"
            >
              {days} dias
            </button>
          ))}
        </div>
      </header>

      {loading && !dashboard ? (
        <section aria-live="polite" className="page-surface dashboard-loading">
          <span className="dashboard-loading__spinner" />
          <div>
            <strong>Calculando indicadores</strong>
            <p>Consultando dados agregados do período selecionado.</p>
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="error-state" role="alert">
          <span className="error-state__icon">
            <Icon name="warning" />
          </span>
          <div>
            <h2>Não foi possível carregar o dashboard</h2>
            <p>{error}</p>
            <button
              className="button button--primary"
              onClick={() => {
                setLoading(true);
                setError(null);
                setRequestVersion((value) => value + 1);
              }}
              type="button"
            >
              Tentar novamente
            </button>
          </div>
        </section>
      ) : null}

      {dashboard ? (
        <>
          <div className="dashboard-refresh-line">
            <span>
              Período desde {formatDashboardDate(dashboard.periodStart)} · Atualizado em{' '}
              {formatDashboardDateTime(dashboard.generatedAt)}
            </span>
            {loading ? <small>Atualizando…</small> : null}
          </div>

          <section aria-label="Indicadores do estoque" className="dashboard-metrics">
            <MetricCard
              label="Produtos ativos"
              value={dashboard.indicators.activeProducts}
              detail="cadastros em operação"
              to="/produtos"
            />
            <MetricCard
              label="Abaixo do mínimo"
              value={dashboard.indicators.belowMinimum}
              detail="com saldo maior que zero"
              tone="warning"
              to="/estoque"
            />
            <MetricCard
              label="Sem estoque"
              value={dashboard.indicators.outOfStock}
              detail="saldo atual zerado"
              tone="danger"
              to="/estoque"
            />
            <MetricCard
              label="Entradas"
              value={dashboard.indicators.entries.movementCount}
              detail={movementSummary(dashboard.indicators.entries)}
              tone="success"
            />
            <MetricCard
              label="Consumo"
              value={dashboard.indicators.consumption.movementCount}
              detail={movementSummary(dashboard.indicators.consumption)}
            />
            <MetricCard
              label="Perdas"
              value={dashboard.indicators.losses.movementCount}
              detail={movementSummary(dashboard.indicators.losses)}
              tone="danger"
              to="/perdas"
            />
            <MetricCard
              label="Movimentações"
              value={dashboard.indicators.movements}
              detail={`total nos últimos ${String(dashboard.periodDays)} dias`}
              to="/relatorios"
            />
          </section>

          <section className="page-surface dashboard-consumption-chart">
            <div className="dashboard-card-heading">
              <div>
                <span>EVOLUÇÃO</span>
                <h2>Consumo por período</h2>
              </div>
              <small>
                {dashboard.periodDays === 90 ? 'Agrupamento semanal' : 'Agrupamento diário'}
              </small>
            </div>
            <TrendChart dashboard={dashboard} unit="KG" />
            <TrendChart dashboard={dashboard} unit="UN" />
          </section>

          <div className="dashboard-analysis-grid">
            <RankingChart items={topConsumed} title="Produtos mais consumidos" />
            <RankingChart items={lossesByCategory} title="Perdas por categoria" />
            <RankingChart items={consumptionByLocation} title="Consumo por local" />
          </div>

          <section className="page-surface dashboard-recent">
            <div className="dashboard-card-heading">
              <div>
                <span>HISTÓRICO</span>
                <h2>Movimentações recentes</h2>
              </div>
              <Link to="/relatorios">Ver relatório completo →</Link>
            </div>
            {dashboard.recentMovements.length === 0 ? (
              <EmptyState
                title="Nenhuma movimentação no período"
                description="As operações confirmadas aparecerão aqui."
              />
            ) : (
              <div className="dashboard-recent__table-wrap">
                <table className="dashboard-recent__table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Operação</th>
                      <th>Local</th>
                      <th>Responsável</th>
                      <th>Quantidade</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recentMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td>
                          <strong>{movement.productName}</strong>
                          <small>{movement.sku}</small>
                        </td>
                        <td>{movementLabel(movement.movementType)}</td>
                        <td>
                          {movement.destinationLocationName ?? movement.sourceLocationName ?? '—'}
                        </td>
                        <td>{movement.responsibleName}</td>
                        <td>
                          <strong>
                            {formatDashboardQuantity(movement.quantity, movement.unit)}
                          </strong>
                        </td>
                        <td>{formatDashboardDateTime(movement.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
