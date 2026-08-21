import { useCallback, useMemo } from 'react';

import {
  LocationService,
  SupabaseLocationRepository,
  type Location,
  type LocationType,
} from '../../../modules/locations';
import { CrudDirectoryPage } from '../../components/operational/CrudDirectoryPage';
import type { TableColumn } from '../../components/ui/DataTable';
import { FormField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { TextAreaField } from '../../components/ui/TextAreaField';

interface LocationForm {
  name: string;
  description: string;
  locationType: LocationType;
}
const emptyForm: LocationForm = { name: '', description: '', locationType: 'CONSUMPTION' };
const columns: readonly TableColumn<Location>[] = [
  { key: 'name', label: 'Local', render: (item) => <strong>{item.name}</strong> },
  {
    key: 'type',
    label: 'Tipo',
    render: (item) => (item.locationType === 'STOCK' ? 'Estoque' : 'Consumo'),
  },
  { key: 'description', label: 'Descrição', render: (item) => item.description ?? '—' },
];

export function LocationsPage() {
  const service = useMemo(() => new LocationService(new SupabaseLocationRepository()), []);
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
          name: value.name,
          description: value.description || null,
          locationType: value.locationType,
        })
      }
      description="Mantenha locais físicos de estoque e destinos de consumo separados."
      emptyForm={emptyForm}
      eyebrow="Estrutura física"
      icon="map-pin"
      itemLabel="Local"
      load={load}
      renderForm={(value: LocationForm, onChange) => (
        <div className="form-grid">
          <FormField
            label="Nome"
            onChange={(event) => {
              onChange({ ...value, name: event.target.value });
            }}
            required
            value={value.name}
          />
          <SelectField
            label="Tipo"
            onChange={(event) => {
              onChange({ ...value, locationType: event.target.value as LocationType });
            }}
            value={value.locationType}
          >
            <option value="STOCK">Estoque</option>
            <option value="CONSUMPTION">Consumo</option>
          </SelectField>
          <TextAreaField
            label="Descrição"
            onChange={(event) => {
              onChange({ ...value, description: event.target.value });
            }}
            value={value.description}
          />
        </div>
      )}
      setActive={(id, active) => (active ? service.reactivate(id) : service.deactivate(id))}
      title="Locais"
      toForm={(item) => ({
        name: item.name,
        description: item.description ?? '',
        locationType: item.locationType,
      })}
      update={(id, value) =>
        service.update(id, {
          name: value.name,
          description: value.description || null,
          locationType: value.locationType,
        })
      }
    />
  );
}
