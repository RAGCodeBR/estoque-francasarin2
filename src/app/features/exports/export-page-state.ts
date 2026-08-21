import {
  getExportDefinition,
  PDF_VISUAL_EXPORT_TYPES,
  type OperationalExportFilters,
  type OperationalExportFormat,
  type OperationalExportType,
} from '../../../modules/data-export';

export interface ExportFilterForm {
  readonly search: string;
  readonly categoryId: string;
  readonly productType: '' | 'RAW' | 'FRACTIONATED';
  readonly activeStatus: '' | 'ACTIVE' | 'INACTIVE';
  readonly invoiceStatus: '' | 'DRAFT' | 'PENDING_REVIEW' | 'CONFIRMED' | 'CANCELLED';
  readonly locationId: string;
  readonly createdFrom: string;
  readonly createdTo: string;
}

export const EMPTY_EXPORT_FILTERS: ExportFilterForm = {
  search: '',
  categoryId: '',
  productType: '',
  activeStatus: '',
  invoiceStatus: '',
  locationId: '',
  createdFrom: '',
  createdTo: '',
};

export const EXPORT_TYPE_OPTIONS: readonly {
  readonly type: OperationalExportType;
  readonly label: string;
  readonly description: string;
}[] = [
  { type: 'PRODUCTS', label: 'Produtos', description: 'Cadastro e classificações dos produtos.' },
  { type: 'CATEGORIES', label: 'Categorias', description: 'Categorias ativas e históricas.' },
  { type: 'LOCATIONS', label: 'Locais', description: 'Locais de estoque e consumo.' },
  {
    type: 'SUPPLIERS',
    label: 'Fornecedores',
    description: 'Cadastros e documentos dos parceiros.',
  },
  {
    type: 'STOCK_CURRENT',
    label: 'Estoque atual',
    description: 'Saldos, mínimos e situação atual.',
  },
  {
    type: 'STOCK_MOVEMENTS',
    label: 'Movimentações',
    description: 'Histórico permanente de movimentos.',
  },
  { type: 'LOSSES', label: 'Perdas', description: 'Perdas, motivos e responsáveis.' },
  { type: 'INVOICES', label: 'Entradas', description: 'Notas, itens e fornecedores.' },
  {
    type: 'PRODUCTS_WITH_CURRENT_STOCK',
    label: 'Cadastro completo de produtos',
    description: 'SKU, EAN, cadastro, saldo, mínimo e status.',
  },
];

export function availableExportFormats(
  type: OperationalExportType,
): readonly OperationalExportFormat[] {
  return PDF_VISUAL_EXPORT_TYPES.includes(type as (typeof PDF_VISUAL_EXPORT_TYPES)[number])
    ? ['XLSX', 'CSV', 'PDF']
    : ['XLSX', 'CSV'];
}

function startOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00-03:00`).toISOString() : undefined;
}

function endOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999-03:00`).toISOString() : undefined;
}

export function buildExportFilters(
  type: OperationalExportType,
  form: ExportFilterForm,
): OperationalExportFilters {
  const allowed = new Set(getExportDefinition(type).allowedFilters);
  const createdFrom = startOfDay(form.createdFrom);
  const createdTo = endOfDay(form.createdTo);
  return {
    ...(allowed.has('search') && form.search.trim() ? { search: form.search.trim() } : {}),
    ...(allowed.has('categoryId') && form.categoryId ? { categoryId: form.categoryId } : {}),
    ...(allowed.has('productType') && form.productType ? { productType: form.productType } : {}),
    ...(allowed.has('isActive') && form.activeStatus
      ? { isActive: form.activeStatus === 'ACTIVE' }
      : {}),
    ...(allowed.has('invoiceStatus') && form.invoiceStatus
      ? { invoiceStatus: form.invoiceStatus }
      : {}),
    ...(allowed.has('locationId') && form.locationId ? { locationId: form.locationId } : {}),
    ...(allowed.has('createdFrom') && createdFrom ? { createdFrom } : {}),
    ...(allowed.has('createdTo') && createdTo ? { createdTo } : {}),
  };
}
