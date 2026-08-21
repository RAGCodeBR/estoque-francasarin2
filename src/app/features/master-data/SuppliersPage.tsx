import { useCallback, useMemo } from 'react';

import {
  SupplierService,
  SupabaseSupplierRepository,
  type Supplier,
} from '../../../modules/suppliers';
import { CrudDirectoryPage } from '../../components/operational/CrudDirectoryPage';
import type { TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';

interface SupplierForm {
  legalName: string;
  tradeName: string;
  document: string;
}
function documentLabel(value: string | null) {
  return value ? value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '—';
}
const columns: readonly TableColumn<Supplier>[] = [
  {
    key: 'name',
    label: 'Fornecedor',
    render: (item) => (
      <div className="table-primary-cell">
        <strong>{item.tradeName ?? item.legalName}</strong>
        {item.tradeName ? <small>{item.legalName}</small> : null}
      </div>
    ),
  },
  { key: 'document', label: 'CNPJ', render: (item) => documentLabel(item.document) },
  {
    key: 'updated',
    label: 'Atualizado',
    render: (item) => new Date(item.updatedAt).toLocaleDateString('pt-BR'),
    align: 'right',
  },
];

export function SuppliersPage() {
  const service = useMemo(() => new SupplierService(new SupabaseSupplierRepository()), []);
  const load = useCallback(
    ({
      search,
      isActive,
      page,
      pageSize,
    }: {
      search: string;
      isActive: boolean | undefined;
      page: number;
      pageSize: number;
    }) =>
      service.search({
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...(isActive === undefined ? {} : { isActive }),
      }),
    [service],
  );
  return (
    <CrudDirectoryPage
      columns={columns}
      create={(value) =>
        service.create({
          legalName: value.legalName,
          tradeName: value.tradeName || null,
          document: value.document || null,
        })
      }
      description="Gerencie parceiros e documentos sem apagar vínculos com notas e produtos."
      emptyForm={{ legalName: '', tradeName: '', document: '' }}
      eyebrow="Parceiros"
      icon="suppliers"
      itemLabel="Fornecedor"
      load={load}
      renderForm={(value: SupplierForm, onChange) => (
        <div className="form-grid">
          <FormField
            label="Razão social"
            onChange={(event) => {
              onChange({ ...value, legalName: event.target.value });
            }}
            required
            value={value.legalName}
          />
          <FormField
            label="Nome fantasia"
            onChange={(event) => {
              onChange({ ...value, tradeName: event.target.value });
            }}
            value={value.tradeName}
          />
          <FormField
            label="CNPJ"
            onChange={(event) => {
              onChange({ ...value, document: event.target.value });
            }}
            value={value.document}
          />
        </div>
      )}
      setActive={(id, active) => (active ? service.reactivate(id) : service.deactivate(id))}
      title="Fornecedores"
      toForm={(item) => ({
        legalName: item.legalName,
        tradeName: item.tradeName ?? '',
        document: item.document ?? '',
      })}
      update={(id, value) =>
        service.update(id, {
          legalName: value.legalName,
          tradeName: value.tradeName || null,
          document: value.document || null,
        })
      }
    />
  );
}
