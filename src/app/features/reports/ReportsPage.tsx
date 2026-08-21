import { useCallback, useMemo, useState } from 'react';

import { ReportService, SupabaseReportRepository } from '../../../modules/reports';
import { EmptyState } from '../../components/feedback/EmptyState';
import { InlineError, OperationalPageHeader } from '../../components/operational/OperationalPage';
import { formatDateTime, formatDecimal } from '../../components/operational/operational-format';
import { DataTable, type TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { usePagedQuery } from '../../hooks/use-paged-query';

type ReportKind = 'STOCK' | 'CONSUMPTION' | 'LOSSES' | 'ENTRIES' | 'MOVEMENTS' | 'MIGRATION';
interface ReportRow {
  id: string;
  primary: string;
  secondary: string;
  category: string;
  quantity: string;
  reference: string;
  date: string;
}

const labels: Readonly<Record<ReportKind, string>> = {
  STOCK: 'Estoque atual',
  CONSUMPTION: 'Consumo',
  LOSSES: 'Perdas',
  ENTRIES: 'Entradas',
  MOVEMENTS: 'Movimentações',
  MIGRATION: 'Migração',
};
const columns: readonly TableColumn<ReportRow>[] = [
  {
    key: 'primary',
    label: 'Registro',
    render: (item) => (
      <div className="table-primary-cell">
        <strong>{item.primary}</strong>
        <small>{item.secondary}</small>
      </div>
    ),
  },
  { key: 'category', label: 'Categoria / local', render: (item) => item.category },
  {
    key: 'quantity',
    label: 'Quantidade',
    render: (item) => <strong>{item.quantity}</strong>,
    align: 'right',
  },
  { key: 'reference', label: 'Referência', render: (item) => item.reference },
  { key: 'date', label: 'Data / situação', render: (item) => item.date, align: 'right' },
];

function startOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00-03:00`).toISOString() : undefined;
}
function endOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999-03:00`).toISOString() : undefined;
}

export function ReportsPage() {
  const service = useMemo(() => new ReportService(new SupabaseReportRepository()), []);
  const [kind, setKind] = useState<ReportKind>('STOCK');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const loader = useCallback(
    async (requestedPage: number) => {
      const pageRequest = { page: requestedPage, pageSize: 25 };
      const createdFrom = startOfDay(from);
      const createdTo = endOfDay(to);
      if (kind === 'STOCK') {
        const result = await service.currentStock({
          ...pageRequest,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        });
        return {
          ...result,
          items: result.items.map((item): ReportRow => ({
            id: item.productId,
            primary: item.productName,
            secondary: item.sku,
            category: item.categoryName ?? 'Sem categoria',
            quantity: formatDecimal(item.balance, item.unit),
            reference: `Mínimo ${formatDecimal(item.minimumQuantity)}`,
            date:
              item.situation === 'OK'
                ? 'Regular'
                : item.situation === 'BELOW_MINIMUM'
                  ? 'Abaixo do mínimo'
                  : 'Sem estoque',
          })),
        };
      }
      if (kind === 'CONSUMPTION') {
        const result = await service.consumption({
          ...pageRequest,
          ...(createdFrom ? { createdFrom } : {}),
          ...(createdTo ? { createdTo } : {}),
        });
        return {
          ...result,
          items: result.items.map((item): ReportRow => ({
            id: `${item.productId}:${item.locationId ?? 'none'}`,
            primary: item.productName,
            secondary: item.sku,
            category: item.locationName ?? item.categoryName ?? '—',
            quantity: formatDecimal(item.quantity, item.unit),
            reference: item.categoryName ?? '—',
            date: `${new Date(item.periodStart).toLocaleDateString('pt-BR')} – ${new Date(item.periodEnd).toLocaleDateString('pt-BR')}`,
          })),
        };
      }
      if (kind === 'LOSSES') {
        const result = await service.losses({
          ...pageRequest,
          ...(createdFrom ? { createdFrom } : {}),
          ...(createdTo ? { createdTo } : {}),
        });
        return {
          ...result,
          items: result.items.map((item): ReportRow => ({
            id: item.id,
            primary: item.productName,
            secondary: item.sku,
            category: item.locationName,
            quantity: formatDecimal(item.quantity, item.unit),
            reference: item.reason,
            date: formatDateTime(item.createdAt),
          })),
        };
      }
      if (kind === 'ENTRIES') {
        const result = await service.entries({
          ...pageRequest,
          ...(createdFrom ? { issuedFrom: createdFrom } : {}),
          ...(createdTo ? { issuedTo: createdTo } : {}),
        });
        return {
          ...result,
          items: result.items.map((item): ReportRow => ({
            id: item.id,
            primary: item.productName,
            secondary: item.sku,
            category: item.supplierTradeName ?? item.supplierLegalName,
            quantity: formatDecimal(item.quantity, item.unit),
            reference: `NF ${item.invoiceNumber}${item.series ? `/${item.series}` : ''}`,
            date: formatDateTime(item.issuedAt),
          })),
        };
      }
      if (kind === 'MOVEMENTS') {
        const result = await service.movements({
          ...pageRequest,
          ...(createdFrom ? { createdFrom } : {}),
          ...(createdTo ? { createdTo } : {}),
        });
        return {
          ...result,
          items: result.items.map((item): ReportRow => ({
            id: item.id,
            primary: item.productName,
            secondary: item.sku,
            category: item.destinationLocationName ?? item.sourceLocationName ?? '—',
            quantity: formatDecimal(item.quantity, item.unit),
            reference: item.movementType,
            date: formatDateTime(item.createdAt),
          })),
        };
      }
      const result = await service.migration({
        ...pageRequest,
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
      });
      return {
        ...result,
        items: result.items.map((item): ReportRow => ({
          id: item.movementId,
          primary: item.productName,
          secondary: item.sku,
          category: item.categoryName ?? '—',
          quantity: formatDecimal(item.openingQuantity, item.unit),
          reference: item.sourceName,
          date: formatDateTime(item.createdAt),
        })),
      };
    },
    [debouncedSearch, from, kind, service, to],
  );
  const query = usePagedQuery(loader, page);

  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Consultas filtradas e paginadas no PostgreSQL, sem carregar coleções inteiras no React."
        eyebrow="Análises"
        icon="chart"
        title="Relatórios"
      />
      <section className="page-surface operational-surface">
        <div className="report-tabs" role="tablist">
          {(Object.keys(labels) as ReportKind[]).map((item) => (
            <button
              aria-selected={kind === item}
              className={kind === item ? 'is-active' : ''}
              key={item}
              onClick={() => {
                setKind(item);
                setPage(1);
              }}
              role="tab"
              type="button"
            >
              {labels[item]}
            </button>
          ))}
        </div>
        <div className="operational-filters operational-filters--reports">
          {kind === 'STOCK' ? (
            <FormField
              label="Pesquisar"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Produto ou SKU"
              value={search}
            />
          ) : (
            <>
              <FormField
                label="Data inicial"
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
                type="date"
                value={from}
              />
              <FormField
                label="Data final"
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
                type="date"
                value={to}
              />
            </>
          )}
          <SelectField
            label="Relatório"
            onChange={(event) => {
              setKind(event.target.value as ReportKind);
              setPage(1);
            }}
            value={kind}
          >
            {(Object.keys(labels) as ReportKind[]).map((item) => (
              <option key={item} value={item}>
                {labels[item]}
              </option>
            ))}
          </SelectField>
        </div>
        <InlineError message={query.error} />
        <DataTable
          caption={labels[kind]}
          columns={columns}
          emptyContent={
            <EmptyState
              compact
              description="Altere os filtros ou o período selecionado."
              title="Nenhum registro encontrado"
            />
          }
          getRowKey={(item) => item.id}
          isLoading={query.loading}
          rows={query.data?.items ?? []}
        />
        <Pagination
          onPageChange={setPage}
          page={query.data?.page ?? page}
          total={query.data?.total ?? 0}
          totalPages={query.data?.totalPages ?? 0}
        />
      </section>
    </div>
  );
}
