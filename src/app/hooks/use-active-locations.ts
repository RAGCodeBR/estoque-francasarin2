import { useEffect, useMemo, useState } from 'react';

import {
  LocationService,
  SupabaseLocationRepository,
  type Location,
  type LocationType,
} from '../../modules/locations';

export function useActiveLocations(type?: LocationType) {
  const service = useMemo(() => new LocationService(new SupabaseLocationRepository()), []);
  const [locations, setLocations] = useState<readonly Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void service
      .search({ page: 1, pageSize: 100, isActive: true, ...(type ? { locationType: type } : {}) })
      .then((page) => {
        setLocations(page.items);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os locais.');
      });
  }, [service, type]);
  return { locations, error };
}
