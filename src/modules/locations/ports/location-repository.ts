import type {
  Location,
  LocationCreateRecord,
  LocationPage,
  LocationSearch,
  LocationUpdateRecord,
} from '../domain/types';

export interface LocationRepository {
  create(record: LocationCreateRecord): Promise<Location>;
  getById(id: string): Promise<Location | null>;
  search(query: LocationSearch): Promise<LocationPage>;
  update(id: string, record: LocationUpdateRecord): Promise<Location>;
  setActive(id: string, isActive: boolean): Promise<Location>;
}
