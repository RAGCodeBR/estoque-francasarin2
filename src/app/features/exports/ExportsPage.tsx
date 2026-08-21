import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CategoryService,
  SupabaseCategoryRepository,
  type Category,
} from '../../../modules/categories';
import {
  getExportDefinition,
  OperationalExportService,
  serializeExportInWorker,
  SupabaseOperationalExportRepository,
  type OperationalExportArtifact,
  type OperationalExportFormat,
  type OperationalExportType,
} from '../../../modules/data-export';
import {
  LocationService,
  SupabaseLocationRepository,
  type Location,
} from '../../../modules/locations';
import { useToast } from '../../components/feedback/toast-context';
import {
  InlineError,
  OperationalPageHeader,
  StatusBadge,
} from '../../components/operational/OperationalPage';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';
import { SelectField } from '../../components/ui/SelectField';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import {
  availableExportFormats,
  buildExportFilters,
  EMPTY_EXPORT_FILTERS,
  EXPORT_TYPE_OPTIONS,
  type ExportFilterForm,
} from './export-page-state';

const FORMAT_LABELS: Readonly<Record<OperationalExportFormat, string>> = {
  XLSX: 'Excel (.xlsx)',
  CSV: 'CSV UTF-8 (.csv)',
  PDF: 'Relatório visual (.pdf)',
  JSON: 'JSON técnico',
};

function useFilterOptions() {
  const categoryService = useMemo(() => new CategoryService(new SupabaseCategoryRepository()), []);
  const locationService = useMemo(() => new LocationService(new SupabaseLocationRepository()), []);
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [locations, setLocations] = useState<readonly Location[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [categoryPage, locationPage] = await Promise.all([
          categoryService.search({ isActive: true, page: 1, pageSize: 100 }),
          locationService.search({ isActive: true, page: 1, pageSize: 100 }),
        ]);
        if (active) {
          setCategories(categoryPage.items);
          setLocations(locationPage.items);
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : 'Não foi possível carregar os filtros.',
          );
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [categoryService, locationService]);

  return { categories, locations, error };
}

function downloadArtifact(artifact: OperationalExportArtifact): void {
  const buffer = artifact.bytes.slice().buffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: artifact.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function ExportsPage() {
  const service = useMemo(
    () =>
      new OperationalExportService(new SupabaseOperationalExportRepository(), {
        serialize: serializeExportInWorker,
      }),
    [],
  );
  const { notify } = useToast();
  const options = useFilterOptions();
  const [type, setType] = useState<OperationalExportType>('PRODUCTS_WITH_CURRENT_STOCK');
  const [format, setFormat] = useState<OperationalExportFormat>('XLSX');
  const [form, setForm] = useState<ExportFilterForm>(EMPTY_EXPORT_FILTERS);
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastArtifact, setLastArtifact] = useState<OperationalExportArtifact | null>(null);
  const estimateRequest = useRef(0);
  const definition = getExportDefinition(type);
  const allowed = useMemo(() => new Set(definition.allowedFilters), [definition]);
  const filters = useMemo(() => buildExportFilters(type, form), [form, type]);
  const debouncedFilters = useDebouncedValue(filters, 450);
  const formats = availableExportFormats(type);

  useEffect(() => {
    const requestId = estimateRequest.current + 1;
    estimateRequest.current = requestId;
    const run = async () => {
      await Promise.resolve();
      if (estimateRequest.current !== requestId) return;
      setEstimating(true);
      setEstimateError(null);
      setEstimatedTotal(null);
      try {
        const total = await service.estimate({ type, filters: debouncedFilters });
        if (estimateRequest.current === requestId) setEstimatedTotal(total);
      } catch (caught) {
        if (estimateRequest.current === requestId) {
          setEstimateError(
            caught instanceof Error ? caught.message : 'Não foi possível estimar os registros.',
          );
        }
      } finally {
        if (estimateRequest.current === requestId) setEstimating(false);
      }
    };
    void run();
    return () => {
      if (estimateRequest.current === requestId) estimateRequest.current += 1;
    };
  }, [debouncedFilters, service, type]);

  const chooseType = useCallback((nextType: OperationalExportType) => {
    setType(nextType);
    setForm(EMPTY_EXPORT_FILTERS);
    setGenerationError(null);
    setLastArtifact(null);
    setFormat((current) => (availableExportFormats(nextType).includes(current) ? current : 'XLSX'));
  }, []);

  const generate = async () => {
    setGenerating(true);
    setGenerationError(null);
    try {
      const artifact = await service.export({
        type,
        format,
        filters,
        idempotencyKey: `export-ui:${type.toLowerCase()}:${crypto.randomUUID()}`,
      });
      downloadArtifact(artifact);
      setLastArtifact(artifact);
      notify({
        title: 'Exportação concluída',
        description: `${artifact.rowCount.toLocaleString('pt-BR')} registros em ${artifact.fileName}.`,
        tone: 'success',
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Não foi possível gerar o arquivo.';
      setGenerationError(message);
      notify({ title: 'Falha na exportação', description: message, tone: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const periodFilters = allowed.has('createdFrom') || allowed.has('createdTo');
  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Gere arquivos portáveis, filtrados no banco e registrados na auditoria administrativa."
        eyebrow="Portabilidade"
        icon="download"
        title="Exportações"
      />

      <section className="page-surface export-workspace">
        <div className="export-section-heading">
          <span>1</span>
          <div>
            <h2>Selecione os dados</h2>
            <p>Escolha um conjunto por arquivo. Nenhum dado de autenticação é incluído.</p>
          </div>
        </div>
        <div className="export-type-grid">
          {EXPORT_TYPE_OPTIONS.map((option) => (
            <button
              aria-pressed={type === option.type}
              className={type === option.type ? 'is-selected' : ''}
              key={option.type}
              onClick={() => {
                chooseType(option.type);
              }}
              type="button"
            >
              <span>
                <Icon
                  name={option.type === 'PRODUCTS_WITH_CURRENT_STOCK' ? 'inventory' : 'file'}
                  size={19}
                />
              </span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>

        <div className="export-divider" />
        <div className="export-section-heading">
          <span>2</span>
          <div>
            <h2>Defina os filtros</h2>
            <p>Os filtros são aplicados no PostgreSQL antes da paginação e da geração.</p>
          </div>
        </div>
        <div className="export-filter-grid">
          {allowed.has('search') ? (
            <FormField
              label="Pesquisar"
              onChange={(event) => {
                setForm((current) => ({ ...current, search: event.target.value }));
              }}
              placeholder="Nome, SKU, documento ou referência"
              value={form.search}
            />
          ) : null}
          {allowed.has('categoryId') ? (
            <SelectField
              label="Categoria"
              onChange={(event) => {
                setForm((current) => ({ ...current, categoryId: event.target.value }));
              }}
              value={form.categoryId}
            >
              <option value="">Todas as categorias</option>
              {options.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {allowed.has('productType') ? (
            <SelectField
              label="Tipo de produto"
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  productType: event.target.value as ExportFilterForm['productType'],
                }));
              }}
              value={form.productType}
            >
              <option value="">Todos os tipos</option>
              <option value="RAW">Bruto</option>
              <option value="FRACTIONATED">Fracionado</option>
            </SelectField>
          ) : null}
          {allowed.has('isActive') ? (
            <SelectField
              label="Status"
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  activeStatus: event.target.value as ExportFilterForm['activeStatus'],
                }));
              }}
              value={form.activeStatus}
            >
              <option value="">Ativos e inativos</option>
              <option value="ACTIVE">Ativos</option>
              <option value="INACTIVE">Inativos</option>
            </SelectField>
          ) : null}
          {allowed.has('invoiceStatus') ? (
            <SelectField
              label="Status da entrada"
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  invoiceStatus: event.target.value as ExportFilterForm['invoiceStatus'],
                }));
              }}
              value={form.invoiceStatus}
            >
              <option value="">Todos os status</option>
              <option value="DRAFT">Rascunho</option>
              <option value="PENDING_REVIEW">Revisão pendente</option>
              <option value="CONFIRMED">Confirmada</option>
              <option value="CANCELLED">Cancelada</option>
            </SelectField>
          ) : null}
          {allowed.has('locationId') ? (
            <SelectField
              label="Local"
              onChange={(event) => {
                setForm((current) => ({ ...current, locationId: event.target.value }));
              }}
              value={form.locationId}
            >
              <option value="">Todos os locais</option>
              {options.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {periodFilters ? (
            <>
              <FormField
                label="Período inicial"
                onChange={(event) => {
                  setForm((current) => ({ ...current, createdFrom: event.target.value }));
                }}
                type="date"
                value={form.createdFrom}
              />
              <FormField
                label="Período final"
                onChange={(event) => {
                  setForm((current) => ({ ...current, createdTo: event.target.value }));
                }}
                type="date"
                value={form.createdTo}
              />
            </>
          ) : null}
        </div>
        <div className="export-filter-actions">
          <Button
            onClick={() => {
              setForm(EMPTY_EXPORT_FILTERS);
            }}
            variant="ghost"
          >
            Limpar filtros
          </Button>
          <div className="export-estimate" aria-live="polite">
            <span>
              <Icon name="inventory" size={20} />
            </span>
            <div>
              <small>Quantidade aproximada</small>
              <strong>
                {estimating
                  ? 'Calculando...'
                  : estimatedTotal === null
                    ? 'Indisponível'
                    : `${estimatedTotal.toLocaleString('pt-BR')} registros`}
              </strong>
            </div>
          </div>
        </div>
        <InlineError message={options.error ?? estimateError} />

        <div className="export-divider" />
        <div className="export-section-heading">
          <span>3</span>
          <div>
            <h2>Escolha o formato</h2>
            <p>Excel e CSV são portáveis; PDF está disponível para relatórios visuais.</p>
          </div>
        </div>
        <div className="export-format-grid">
          {formats.map((item) => (
            <button
              aria-pressed={format === item}
              className={format === item ? 'is-selected' : ''}
              key={item}
              onClick={() => {
                setFormat(item);
              }}
              type="button"
            >
              <span>{item}</span>
              <strong>{FORMAT_LABELS[item]}</strong>
              <small>
                {item === 'XLSX'
                  ? 'Excel e Google Sheets'
                  : item === 'CSV'
                    ? 'UTF-8 com BOM'
                    : 'Paginação visual A4'}
              </small>
            </button>
          ))}
        </div>

        {estimatedTotal !== null && estimatedTotal > 5_000 ? (
          <div className="export-large-notice">
            <Icon name="history" size={20} />
            <div>
              <strong>Exportação de grande volume</strong>
              <p>
                Os dados serão lidos em páginas de 500 registros e o arquivo será montado em segundo
                plano para manter a interface responsiva.
              </p>
            </div>
          </div>
        ) : null}
        <InlineError message={generationError} />
        <div className="export-submit">
          <div>
            <small>Arquivo selecionado</small>
            <strong>
              {EXPORT_TYPE_OPTIONS.find((option) => option.type === type)?.label} ·{' '}
              {FORMAT_LABELS[format]}
            </strong>
          </div>
          <Button
            disabled={estimating || estimatedTotal === null || estimatedTotal === 0}
            isLoading={generating}
            onClick={() => {
              void generate();
            }}
          >
            <Icon name="download" size={18} />{' '}
            {generating ? 'Gerando em segundo plano...' : 'Gerar e baixar'}
          </Button>
        </div>
      </section>

      {lastArtifact ? (
        <section className="page-surface export-result" aria-live="polite">
          <span className="export-result__icon">
            <Icon name="check" size={23} />
          </span>
          <div>
            <StatusBadge tone="success">Concluída</StatusBadge>
            <h2>{lastArtifact.fileName}</h2>
            <p>
              {lastArtifact.rowCount.toLocaleString('pt-BR')} registros ·{' '}
              {readableSize(lastArtifact.bytes.byteLength)} · schema v{lastArtifact.schemaVersion}
            </p>
          </div>
          <Button
            onClick={() => {
              downloadArtifact(lastArtifact);
            }}
            variant="secondary"
          >
            Baixar novamente
          </Button>
        </section>
      ) : null}
    </div>
  );
}
