import { useCallback, useMemo, useState } from 'react';

import { AuditService, SupabaseAuditRepository, type AuditLog } from '../../../modules/audit';
import { EmptyState } from '../../components/feedback/EmptyState';
import { InlineError, OperationalPageHeader } from '../../components/operational/OperationalPage';
import { formatDateTime } from '../../components/operational/operational-format';
import { DataTable, type TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { usePagedQuery } from '../../hooks/use-paged-query';

const columns: readonly TableColumn<AuditLog>[] = [
  {
    key: 'action',
    label: 'Evento',
    render: (item) => (
      <div className="table-primary-cell">
        <strong>{item.action}</strong>
        <small>{item.entityType}</small>
      </div>
    ),
  },
  {
    key: 'entity',
    label: 'Entidade',
    render: (item) => (item.entityId ? <code>{item.entityId}</code> : '—'),
  },
  {
    key: 'actor',
    label: 'Responsável',
    render: (item) => (item.actorId ? <code>{item.actorId}</code> : 'Sistema'),
  },
  {
    key: 'request',
    label: 'Rastreabilidade',
    render: (item) => (item.requestId ? <code>{item.requestId}</code> : '—'),
  },
  { key: 'date', label: 'Data', render: (item) => formatDateTime(item.createdAt), align: 'right' },
];
function timestamp(value: string, end: boolean): string | undefined {
  return value
    ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}-03:00`).toISOString()
    : undefined;
}

export function AuditLogsPage() {
  const service = useMemo(() => new AuditService(new SupabaseAuditRepository()), []);
  const [action, setAction] = useState('');
  const debouncedAction = useDebouncedValue(action);
  const [entityType, setEntityType] = useState('');
  const debouncedEntity = useDebouncedValue(entityType);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const loader = useCallback(
    (requestedPage: number) => {
      const createdFrom = timestamp(from, false);
      const createdTo = timestamp(to, true);
      return service.search({
        page: requestedPage,
        pageSize: 25,
        ...(debouncedAction ? { action: debouncedAction } : {}),
        ...(debouncedEntity ? { entityType: debouncedEntity } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(createdTo ? { createdTo } : {}),
      });
    },
    [debouncedAction, debouncedEntity, from, service, to],
  );
  const query = usePagedQuery(loader, page);
  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Histórico administrativo imutável para usuários comuns, com filtros e paginação no banco."
        eyebrow="Auditoria"
        icon="history"
        title="Logs"
      />
      <section className="page-surface operational-surface">
        <div className="operational-filters operational-filters--logs">
          <FormField
            label="Ação"
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            placeholder="Ex.: PRODUCT_UPDATED"
            value={action}
          />
          <FormField
            label="Tipo de entidade"
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
            placeholder="Ex.: product"
            value={entityType}
          />
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
        </div>
        <InlineError message={query.error} />
        <DataTable
          caption="Logs de auditoria"
          columns={columns}
          emptyContent={
            <EmptyState
              compact
              description="Nenhum evento corresponde aos filtros."
              title="Logs não encontrados"
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
