import type { PageRequest, PaginatedResult } from '../../../types/pagination';

export type LocationType = 'STOCK' | 'CONSUMPTION';

export interface Location {
  id: string;
  name: string;
  description: string | null;
  locationType: LocationType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocationInput {
  name: string;
  description?: string | null;
  locationType: LocationType;
}

export interface UpdateLocationInput {
  name?: string;
  description?: string | null;
  locationType?: LocationType;
}

export interface LocationSearch extends PageRequest {
  search?: string;
  locationType?: LocationType;
  isActive?: boolean;
}

export type LocationPage = PaginatedResult<Location>;

export interface LocationCreateRecord {
  name: string;
  description: string | null;
  locationType: LocationType;
}

export interface LocationUpdateRecord {
  name?: string;
  description?: string | null;
  locationType?: LocationType;
  isActive?: boolean;
}
