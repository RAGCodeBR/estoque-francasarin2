import { useMemo, useState } from 'react';

import { EmptyState } from '../components/feedback/EmptyState';
import { DataTable, type TableColumn } from '../components/ui/DataTable';
import { FormField } from '../components/ui/FormField';
import { Icon } from '../components/ui/Icon';
import type { AppRouteDefinition } from '../navigation/route-config';

interface PlaceholderRow {
  id: string;
}

const columns: readonly TableColumn<PlaceholderRow>[] = [
  { key: 'reference', label: 'Referência', render: (row) => row.id },
  { key: 'description', label: 'Descrição', render: () => '—' },
  { key: 'status', label: 'Situação', render: () => '—' },
  { key: 'updated', label: 'Atualização', render: () => '—', align: 'right' },
];

export function ModulePlaceholderPage({ route }: { route: AppRouteDefinition }) {
  const [search, setSearch] = useState('');
  const rows = useMemo<readonly PlaceholderRow[]>(() => [], []);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="page-heading__eyebrow">{route.eyebrow}</span>
          <h1>{route.label}</h1>
          <p>{route.description}</p>
        </div>
        <span className="module-badge">
          <Icon name={route.icon} size={18} />
          Estrutura inicial
        </span>
      </header>

      <section className="page-surface module-surface">
        <div className="module-toolbar">
          <FormField
            aria-label={`Pesquisar em ${route.label}`}
            className="module-search"
            label="Pesquisar"
            leading={<Icon name="search" size={18} />}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Busque por nome ou referência"
            value={search}
          />
          <span className="module-toolbar__note">Filtros serão processados no banco</span>
        </div>

        <DataTable
          caption={`Registros de ${route.label}`}
          columns={columns}
          emptyContent={
            <EmptyState
              compact
              description="A estrutura desta tela está pronta para receber o domínio no bloco correspondente."
              title="Nenhum dado carregado nesta etapa"
            />
          }
          getRowKey={(row) => row.id}
          rows={rows}
        />
      </section>
    </div>
  );
}
