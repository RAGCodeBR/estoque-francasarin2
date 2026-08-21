import { useCallback, useState, type ReactNode, type SyntheticEvent } from 'react';

import { hasPermission } from '../../../modules/auth';
import type { PaginatedResult } from '../../../types/pagination';
import { useAuth } from '../../auth/auth-context';
import { useToast } from '../feedback/toast-context';
import { EmptyState } from '../feedback/EmptyState';
import { Button } from '../ui/Button';
import { DataTable, type TableColumn } from '../ui/DataTable';
import { Dialog } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { Icon } from '../ui/Icon';
import { Pagination } from '../ui/Pagination';
import { SelectField } from '../ui/SelectField';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { usePagedQuery } from '../../hooks/use-paged-query';
import { InlineError, OperationalPageHeader, StatusBadge } from './OperationalPage';
import type { AppIconName } from '../../navigation/route-config';

interface CrudDirectoryPageProps<Item extends { id: string; isActive: boolean }, FormValue> {
  title: string;
  eyebrow: string;
  description: string;
  icon: AppIconName;
  itemLabel: string;
  columns: readonly TableColumn<Item>[];
  emptyForm: FormValue;
  toForm: (item: Item) => FormValue;
  renderForm: (value: FormValue, onChange: (value: FormValue) => void) => ReactNode;
  load: (query: {
    search: string;
    isActive: boolean | undefined;
    page: number;
    pageSize: number;
  }) => Promise<PaginatedResult<Item>>;
  create: (value: FormValue) => Promise<Item>;
  update: (id: string, value: FormValue) => Promise<Item>;
  setActive: (id: string, active: boolean) => Promise<Item>;
}

const PAGE_SIZE = 25;

export function CrudDirectoryPage<Item extends { id: string; isActive: boolean }, FormValue>({
  columns,
  create,
  description,
  emptyForm,
  eyebrow,
  icon,
  itemLabel,
  load,
  renderForm,
  setActive,
  title,
  toForm,
  update,
}: CrudDirectoryPageProps<Item, FormValue>) {
  const auth = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(auth.context.roles, 'MANAGE_SYSTEM');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<FormValue>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const loader = useCallback(
    (requestedPage: number) =>
      load({
        search: debouncedSearch,
        isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
        page: requestedPage,
        pageSize: PAGE_SIZE,
      }),
    [activeFilter, debouncedSearch, load],
  );
  const query = usePagedQuery(loader, page);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setMutationError(null);
    setDialogOpen(true);
  };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm(toForm(item));
    setMutationError(null);
    setDialogOpen(true);
  };

  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMutationError(null);
    try {
      if (editing) await update(editing.id, form);
      else await create(form);
      setDialogOpen(false);
      query.reload();
      notify({
        title: editing ? `${itemLabel} atualizado` : `${itemLabel} criado`,
        description: 'A alteração foi confirmada pelo backend.',
        tone: 'success',
      });
    } catch (caught) {
      setMutationError(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: Item) => {
    setMutationError(null);
    try {
      await setActive(item.id, !item.isActive);
      query.reload();
      notify({
        title: item.isActive ? `${itemLabel} inativado` : `${itemLabel} reativado`,
        description: 'O histórico foi preservado.',
        tone: 'success',
      });
    } catch (caught) {
      setMutationError(
        caught instanceof Error ? caught.message : 'Não foi possível alterar o status.',
      );
    }
  };

  const tableColumns: readonly TableColumn<Item>[] = [
    ...columns,
    {
      key: 'active',
      label: 'Situação',
      align: 'center',
      render: (item: Item) => (
        <StatusBadge tone={item.isActive ? 'success' : 'neutral'}>
          {item.isActive ? 'Ativo' : 'Inativo'}
        </StatusBadge>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            label: 'Ações',
            align: 'right' as const,
            render: (item: Item) => (
              <div className="table-actions">
                <button
                  onClick={() => {
                    openEdit(item);
                  }}
                  type="button"
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    void toggleActive(item);
                  }}
                  type="button"
                >
                  {item.isActive ? 'Inativar' : 'Reativar'}
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="page-stack">
      <OperationalPageHeader
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Icon name="package" size={18} /> Novo {itemLabel.toLocaleLowerCase('pt-BR')}
            </Button>
          ) : undefined
        }
        description={description}
        eyebrow={eyebrow}
        icon={icon}
        title={title}
      />
      <section className="page-surface operational-surface">
        <div className="operational-filters operational-filters--directory">
          <FormField
            label={`Pesquisar ${title.toLocaleLowerCase('pt-BR')}`}
            leading={<Icon name="search" size={18} />}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Nome ou referência"
            value={search}
          />
          <SelectField
            label="Situação"
            onChange={(event) => {
              setActiveFilter(event.target.value as typeof activeFilter);
              setPage(1);
            }}
            value={activeFilter}
          >
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
            <option value="all">Todos</option>
          </SelectField>
        </div>
        <InlineError message={mutationError ?? query.error} />
        <DataTable
          caption={title}
          columns={tableColumns}
          emptyContent={
            <EmptyState
              compact
              description="Ajuste a pesquisa ou cadastre um novo registro."
              title={`Nenhum ${itemLabel.toLocaleLowerCase('pt-BR')} encontrado`}
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

      <Dialog
        description="O saldo e os históricos não fazem parte desta edição."
        onClose={() => {
          setDialogOpen(false);
        }}
        open={dialogOpen}
        title={
          editing
            ? `Editar ${itemLabel.toLocaleLowerCase('pt-BR')}`
            : `Novo ${itemLabel.toLocaleLowerCase('pt-BR')}`
        }
      >
        <form
          className="operational-form"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          {renderForm(form, setForm)}
          <InlineError message={mutationError} />
          <div className="dialog-actions">
            <Button
              onClick={() => {
                setDialogOpen(false);
              }}
              variant="secondary"
            >
              Cancelar
            </Button>
            <Button isLoading={saving} type="submit">
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
