import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getAuthenticatedUserId,
  getSupabaseClient,
  isRecord,
  nullableString,
  parsePagePayload,
  requiredBoolean,
  requiredString,
  unwrapSupabaseResponse,
} from '../../../lib/supabase';
import { createPaginatedResult } from '../../../types/pagination';
import type {
  Location,
  LocationCreateRecord,
  LocationPage,
  LocationSearch,
  LocationType,
  LocationUpdateRecord,
} from '../domain/types';
import type { LocationRepository } from '../ports/location-repository';

const LOCATION_COLUMNS = 'id,name,description,location_type,is_active,created_at,updated_at';

function parseLocationType(value: string): LocationType {
  if (value !== 'STOCK' && value !== 'CONSUMPTION') {
    throw new Error('Tipo de local inválido na resposta do banco.');
  }
  return value;
}

function parseLocation(value: unknown): Location {
  if (!isRecord(value)) throw new Error('Local inválido na resposta do banco.');
  return {
    id: requiredString(value, 'id'),
    name: requiredString(value, 'name'),
    description: nullableString(value, 'description'),
    locationType: parseLocationType(requiredString(value, 'location_type')),
    isActive: requiredBoolean(value, 'is_active'),
    createdAt: requiredString(value, 'created_at'),
    updatedAt: requiredString(value, 'updated_at'),
  };
}

function toDatabaseRecord(record: LocationCreateRecord | LocationUpdateRecord) {
  return {
    ...(record.name === undefined ? {} : { name: record.name }),
    ...(record.description !== undefined ? { description: record.description } : {}),
    ...(record.locationType === undefined ? {} : { location_type: record.locationType }),
    ...('isActive' in record ? { is_active: record.isActive } : {}),
  };
}

export class SupabaseLocationRepository implements LocationRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseClient()) {}

  async create(record: LocationCreateRecord): Promise<Location> {
    const actorId = await getAuthenticatedUserId(this.client);
    const data = await unwrapSupabaseResponse(
      this.client
        .from('locations')
        .insert({ ...toDatabaseRecord(record), created_by: actorId, updated_by: actorId })
        .select(LOCATION_COLUMNS)
        .single(),
    );
    return parseLocation(data);
  }

  async getById(id: string): Promise<Location | null> {
    const data = await unwrapSupabaseResponse(
      this.client.from('locations').select(LOCATION_COLUMNS).eq('id', id).maybeSingle(),
    );
    return data === null ? null : parseLocation(data);
  }

  async search(query: LocationSearch): Promise<LocationPage> {
    const payload = parsePagePayload(
      await unwrapSupabaseResponse(
        this.client.rpc('search_locations', {
          p_search: query.search ?? null,
          p_location_type: query.locationType ?? null,
          p_is_active: query.isActive ?? null,
          p_page: query.page,
          p_page_size: query.pageSize,
        }),
      ),
    );
    return createPaginatedResult(
      payload.items.map(parseLocation),
      payload.total,
      payload.page,
      payload.pageSize,
    );
  }

  async update(id: string, record: LocationUpdateRecord): Promise<Location> {
    const actorId = await getAuthenticatedUserId(this.client);
    const data = await unwrapSupabaseResponse(
      this.client
        .from('locations')
        .update({ ...toDatabaseRecord(record), updated_by: actorId })
        .eq('id', id)
        .select(LOCATION_COLUMNS)
        .single(),
    );
    return parseLocation(data);
  }

  async setActive(id: string, isActive: boolean): Promise<Location> {
    return this.update(id, { isActive });
  }
}
