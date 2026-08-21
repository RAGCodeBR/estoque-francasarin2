import { useMemo, useState, type SyntheticEvent } from 'react';

import { LossService, SupabaseLossRepository, type StockLossReport } from '../../../modules/losses';
import type { Product } from '../../../modules/products';
import { LocationSelect, ProductSearchField } from '../../components/operational/EntityPickers';
import {
  InlineError,
  OperationalPageHeader,
  StatusBadge,
} from '../../components/operational/OperationalPage';
import {
  createIdempotencyKey,
  formatDateTime,
  formatDecimal,
} from '../../components/operational/operational-format';
import { useActiveLocations } from '../../hooks/use-active-locations';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Icon } from '../../components/ui/Icon';
import { TextAreaField } from '../../components/ui/TextAreaField';

export function LossesPage() {
  const service = useMemo(() => new LossService(new SupabaseLossRepository()), []);
  const stocks = useActiveLocations('STOCK');
  const [product, setProduct] = useState<Product | null>(null);
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<StockLossReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product) {
      setError('Selecione o produto da perda.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await service.register({
          productId: product.id,
          locationId,
          quantity,
          reason,
          ...(notes.trim() ? { notes } : {}),
          idempotencyKey: createIdempotencyKey('loss'),
        }),
      );
      setQuantity('');
      setReason('');
      setNotes('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar a perda.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <OperationalPageHeader
        description="Registre perdas rastreáveis. O saldo só muda pela operação transacional confirmada."
        eyebrow="Controle de perdas"
        icon="warning"
        title="Perdas"
      />
      <div className="operation-layout">
        <form
          className="page-surface operational-surface operational-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <ProductSearchField onSelect={setProduct} selected={product} />
          <div className="form-grid form-grid--two">
            <LocationSelect
              label="Local da perda"
              locations={stocks.locations}
              onChange={setLocationId}
              value={locationId}
            />
            <FormField
              label="Quantidade"
              onChange={(event) => {
                setQuantity(event.target.value);
              }}
              placeholder="0.000"
              required
              value={quantity}
            />
          </div>
          <FormField
            label="Motivo"
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            placeholder="Ex.: validade expirada"
            required
            value={reason}
          />
          <TextAreaField
            label="Observação"
            maxLength={2000}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
            placeholder="Detalhes adicionais"
            value={notes}
          />
          <InlineError message={error ?? stocks.error} />
          <div className="operation-submit">
            <span>A correção futura deverá gerar movimento compensatório.</span>
            <Button disabled={!product || !locationId} isLoading={busy} type="submit">
              <Icon name="warning" size={18} /> Registrar perda
            </Button>
          </div>
        </form>
        <aside className="page-surface operation-summary">
          <span className="page-heading__eyebrow">Comprovante</span>
          {result ? (
            <div className="backend-result">
              <StatusBadge tone="success">Confirmado</StatusBadge>
              <h2>{formatDecimal(result.quantity, result.unit)}</h2>
              <p>
                Novo saldo: <strong>{formatDecimal(result.newBalance, result.unit)}</strong>
              </p>
              <small>{formatDateTime(result.createdAt)}</small>
              <code>{result.movementId}</code>
            </div>
          ) : (
            <p>
              Após a confirmação, quantidade, unidade e novo saldo serão exibidos exclusivamente a
              partir da resposta do backend.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
