import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CategoryService,
  SupabaseCategoryRepository,
  type Category,
} from '../../../modules/categories';
import {
  ReportService,
  SupabaseReportRepository,
  type CurrentStockReportItem,
  type ReportProductType,
  type StockSituation,
} from '../../../modules/reports';
import { EmptyState } from '../../components/feedback/EmptyState';
import {
  InlineError,
  OperationalPageHeader,
  StatusBadge,
} from '../../components/operational/OperationalPage';
import { formatDecimal } from '../../components/operational/operational-format';
import { DataTable, type TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { usePagedQuery } from '../../hooks/use-paged-query';
import { buildCurrentStockQuery } from './stock-query';

const PAGE_SIZE = 25;

function situationBadge(item: CurrentStockReportItem) {
  if (item.situation === 'OUT_OF_STOCK')
    return <StatusBadge tone="danger">Sem estoque</StatusBadge>;
  if (item.situation === 'BELOW_MINIMUM')
    return <StatusBadge tone="warning">Abaixo do mínimo</StatusBadge>;
  return <StatusBadge tone="success">Regular</StatusBadge>;
}

const columns: readonly TableColumn<CurrentStockReportItem>[] = [
  {
    key: 'product',
    label: 'Produto',
    render: (item) => (
      <div className="table-primary-cell">
        <strong>{item.productName}</strong>
        {!item.isActive ? <small>Produto inativo</small> : null}
      </div>
    ),
  },
  { key: 'sku', label: 'SKU', render: (item) => <code>{item.sku}</code> },
  { key: 'category', label: 'Categoria', render: (item) => item.categoryName ?? 'Sem categoria' },
  {
    key: 'type',
    label: 'Tipo',
    render: (item) => (item.productType === 'RAW' ? 'Bruto' : 'Fracionado'),
  },
  { key: 'unit', label: 'Unidade', render: (item) => item.unit, align: 'center' },
  {
    key: 'balance',
    label: 'Saldo',
    render: (item) => <strong>{formatDecimal(item.balance)}</strong>,
    align: 'right',
  },
  {
    key: 'minimum',
    label: 'Mínimo',
    render: (item) => formatDecimal(item.minimumQuantity),
    align: 'right',
  },
  { key: 'situation', label: 'Situação', render: situationBadge, align: 'right' },
];

export function StockPage() {
  const reportService = useMemo(() => new ReportService(new SupabaseReportRepository()), []);
  const categoryService = useMemo(() => new CategoryService(new SupabaseCategoryRepository()), []);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [productType, setProductType] = useState<ReportProductType | ''>('');
  const [categoryId, setCategoryId] = useState('');
  const [situation, setSituation] = useState<StockSituation | ''>('');
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<readonly Category[]>([]);

  useEffect(() => {
    void categoryService
      .search({ isActive: true, page: 1, pageSize: 100 })
      .then((result) => {
        setCategories(result.items);
      })
      .catch(() => {
        setCategories([]);
      });
  }, [categoryService]);

  const loader = useCallback(
    (requestedPage: number) =>
      reportService.currentStock(
        buildCurrentStockQuery({
          page: requestedPage,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          productType,
          categoryId,
          situation,
        }),
      ),
    [categoryId, debouncedSearch, productType, reportService, situation],
  );
  const query = usePagedQuery(loader, page);

  const changeType = (next: ReportProductType | '') => {
    setProductType(next);
    setPage(1);
  };

  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Consulte produtos brutos e fracionados juntos. Filtros e paginação são executados no banco."
        eyebrow="Estoque atual"
        icon="inventory"
        title="Estoque"
      />

      <section className="page-surface operational-surface">
        <div className="filter-tabs" role="group" aria-label="Tipo de produto">
          <button
            className={!productType ? 'is-active' : ''}
            onClick={() => {
              changeType('');
            }}
            type="button"
          >
            Todos
          </button>
          <button
            className={productType === 'RAW' ? 'is-active' : ''}
            onClick={() => {
              changeType('RAW');
            }}
            type="button"
          >
            Brutos
          </button>
          <button
            className={productType === 'FRACTIONATED' ? 'is-active' : ''}
            onClick={() => {
              changeType('FRACTIONATED');
            }}
            type="button"
          >
            Fracionados
          </button>
        </div>
        <div className="operational-filters operational-filters--stock">
          <FormField
            label="Pesquisar produto"
            leading={<Icon name="search" size={18} />}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Nome ou SKU"
            value={search}
          />
          <SelectField
            label="Categoria"
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
            value={categoryId}
          >
            <option value="">Todas as categorias</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Situação"
            onChange={(event) => {
              setSituation(event.target.value as StockSituation | '');
              setPage(1);
            }}
            value={situation}
          >
            <option value="">Todas</option>
            <option value="BELOW_MINIMUM">Abaixo do mínimo</option>
            <option value="OUT_OF_STOCK">Sem estoque</option>
            <option value="OK">Regular</option>
          </SelectField>
        </div>
        <InlineError message={query.error} />
        <DataTable
          caption="Estoque atual"
          columns={columns}
          emptyContent={
            <EmptyState
              compact
              description="Nenhum produto corresponde aos filtros selecionados."
              title="Estoque não encontrado"
            />
          }
          getRowKey={(item) => item.productId}
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
