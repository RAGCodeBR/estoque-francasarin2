import { useMemo, useState, type ChangeEvent, type SyntheticEvent } from 'react';

import {
  NfeImportService,
  PdfInvoiceImportService,
  PdfJsTextExtractor,
  SupabaseNfeRepository,
  SupabaseNfeXmlStorage,
  SupabasePdfInvoiceRepository,
  SupabasePdfInvoiceStorage,
  type NfeConfirmationReport,
  type PdfInvoiceImportPreview,
} from '../../../modules/invoices';
import { LocationSelect } from '../../components/operational/EntityPickers';
import {
  InlineError,
  OperationalPageHeader,
  StatusBadge,
} from '../../components/operational/OperationalPage';
import { createIdempotencyKey } from '../../components/operational/operational-format';
import { useActiveLocations } from '../../hooks/use-active-locations';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';

type InvoiceFormat = 'XML' | 'PDF';

export function EntriesPage() {
  const xmlService = useMemo(
    () => new NfeImportService(new SupabaseNfeRepository(), new SupabaseNfeXmlStorage()),
    [],
  );
  const pdfService = useMemo(
    () =>
      new PdfInvoiceImportService(
        new SupabasePdfInvoiceRepository(),
        new SupabasePdfInvoiceStorage(),
        new PdfJsTextExtractor(),
      ),
    [],
  );
  const stocks = useActiveLocations('STOCK');
  const [format, setFormat] = useState<InvoiceFormat>('XML');
  const [importId, setImportId] = useState('');
  const [preview, setPreview] = useState<PdfInvoiceImportPreview | null>(null);
  const [locationId, setLocationId] = useState('');
  const [result, setResult] = useState<NfeConfirmationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (format === 'XML') {
        setImportId(await xmlService.upload(file));
        setPreview(null);
      } else {
        const id = await pdfService.upload(file);
        setImportId(id);
        setPreview(await pdfService.getPreview(id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível processar o arquivo.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const confirm = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const service = format === 'XML' ? xmlService : pdfService;
      setResult(await service.confirm(importId, locationId, createIdempotencyKey('invoice-entry')));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A entrada não pôde ser confirmada.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="XML é preferencial. PDF permanece assistido e nenhum arquivo movimenta estoque apenas por ser lido."
        eyebrow="Recebimento"
        icon="arrow-down"
        title="Entradas"
      />
      <div className="operation-layout">
        <section className="page-surface operational-surface operational-form">
          <div className="filter-tabs" role="group" aria-label="Formato da nota">
            <button
              className={format === 'XML' ? 'is-active' : ''}
              onClick={() => {
                setFormat('XML');
                setPreview(null);
                setResult(null);
              }}
              type="button"
            >
              NF-e XML
            </button>
            <button
              className={format === 'PDF' ? 'is-active' : ''}
              onClick={() => {
                setFormat('PDF');
                setPreview(null);
                setResult(null);
              }}
              type="button"
            >
              PDF assistido
            </button>
          </div>
          <label className="invoice-upload">
            <span>
              <Icon name="upload" size={24} />
            </span>
            <strong>{busy ? 'Processando arquivo...' : `Selecionar ${format}`}</strong>
            <small>
              {format === 'XML'
                ? 'Validação fiscal e staging seguro'
                : 'Extração sem inventar campos ausentes'}
            </small>
            <input
              accept={format === 'XML' ? '.xml,application/xml,text/xml' : '.pdf,application/pdf'}
              disabled={busy}
              onChange={(event) => {
                void upload(event);
              }}
              type="file"
            />
          </label>
          {importId ? (
            <div className="staging-ticket">
              <StatusBadge tone="warning">Staging criado</StatusBadge>
              <span>Importação</span>
              <code>{importId}</code>
              <p>
                A nota ainda precisa estar completamente revisada e em estado READY antes da
                confirmação.
              </p>
            </div>
          ) : null}
          {preview ? (
            <div className="pdf-preview-summary">
              <strong>Preview PDF disponível</strong>
              <span>{preview.items.length} item(ns) extraído(s)</span>
              <p>
                Campos incompletos permanecem pendentes; a RPC recusará confirmação sem revisão
                humana integral.
              </p>
            </div>
          ) : null}
          <InlineError message={error ?? stocks.error} />
        </section>
        <form
          className="page-surface operation-summary operational-form"
          onSubmit={(event) => {
            void confirm(event);
          }}
        >
          <span className="page-heading__eyebrow">Confirmação da entrada</span>
          <FormField
            label="ID da importação revisada"
            onChange={(event) => {
              setImportId(event.target.value);
            }}
            required
            value={importId}
          />
          <LocationSelect
            label="Destino de estoque"
            locations={stocks.locations}
            onChange={setLocationId}
            value={locationId}
          />
          <p className="form-safety-note">
            A confirmação cria nota, itens e movimentos na mesma transação. Lotes pendentes serão
            recusados pelo backend.
          </p>
          <Button disabled={!importId || !locationId} isLoading={busy} type="submit">
            <Icon name="check" size={18} /> Confirmar entrada
          </Button>
          {result ? (
            <div className="backend-result">
              <StatusBadge tone="success">Confirmado</StatusBadge>
              <h2>{result.movementsCreated} entrada(s)</h2>
              <p>
                {result.itemsCreated} itens · {result.supplierMappingsCreated} associações
              </p>
              <code>{result.invoiceId}</code>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
