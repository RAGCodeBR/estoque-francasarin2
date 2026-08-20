import { resolvePageRequest } from '../../../types/pagination';
import {
  assertUuid,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeSearch,
} from '../../../utils/domain-values';
import type {
  CreateLocationInput,
  Location,
  LocationPage,
  LocationSearch,
  LocationType,
  UpdateLocationInput,
} from '../domain/types';
import type { LocationRepository } from '../ports/location-repository';

function assertLocationType(value: unknown): LocationType {
  if (value !== 'STOCK' && value !== 'CONSUMPTION') throw new Error('Tipo de local inválido.');
  return value;
}

export class LocationService {
  constructor(private readonly repository: LocationRepository) {}

  create(input: CreateLocationInput): Promise<Location> {
    return this.repository.create({
      name: normalizeRequiredText(input.name, 'Nome do local'),
      description: normalizeOptionalText(input.description),
      locationType: assertLocationType(input.locationType),
    });
  }

  getById(id: string): Promise<Location | null> {
    return this.repository.getById(assertUuid(id, 'ID do local'));
  }

  search(query: LocationSearch = {}): Promise<LocationPage> {
    const page = resolvePageRequest(query);
    const search = normalizeSearch(query.search);
    return this.repository.search({
      ...page,
      ...(search ? { search } : {}),
      ...(query.locationType ? { locationType: assertLocationType(query.locationType) } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    });
  }

  update(id: string, input: UpdateLocationInput): Promise<Location> {
    const record = {
      ...(input.name === undefined
        ? {}
        : { name: normalizeRequiredText(input.name, 'Nome do local') }),
      ...(input.description === undefined
        ? {}
        : { description: normalizeOptionalText(input.description) }),
      ...(input.locationType === undefined
        ? {}
        : { locationType: assertLocationType(input.locationType) }),
    };
    if (Object.keys(record).length === 0) throw new Error('Informe ao menos um campo para edição.');
    return this.repository.update(assertUuid(id, 'ID do local'), record);
  }

  deactivate(id: string): Promise<Location> {
    return this.repository.setActive(assertUuid(id, 'ID do local'), false);
  }

  reactivate(id: string): Promise<Location> {
    return this.repository.setActive(assertUuid(id, 'ID do local'), true);
  }
}
