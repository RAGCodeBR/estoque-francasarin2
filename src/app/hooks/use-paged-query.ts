import { useCallback, useEffect, useRef, useState } from 'react';

import type { PaginatedResult } from '../../types/pagination';

export function usePagedQuery<T>(
  loader: (page: number) => Promise<PaginatedResult<T>>,
  page: number,
) {
  const [data, setData] = useState<PaginatedResult<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const run = async () => {
      await Promise.resolve();
      if (requestId !== requestRef.current) return;
      setLoading(true);
      setError(null);
      try {
        const result = await loader(page);
        if (requestId === requestRef.current) setData(result);
      } catch (caught) {
        if (requestId === requestRef.current)
          setError(
            caught instanceof Error ? caught.message : 'Não foi possível carregar os dados.',
          );
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    };
    void run();
    return () => {
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [loader, page, revision]);

  const reload = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  return { data, error, loading, reload };
}
