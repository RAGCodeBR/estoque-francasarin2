import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSupabaseClient } from '../../lib/supabase';
import {
  getCurrentAuthContext,
  signOut,
  type AuthContext as DomainAuthContext,
} from '../../modules/auth';
import { AuthStateContext, type AuthStatus } from './auth-context';

interface AuthState {
  status: AuthStatus;
  context: DomainAuthContext;
  error: string | null;
}

const initialContext: DomainAuthContext = { user: null, roles: [] };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível verificar a sessão.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    context: initialContext,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const context = await getCurrentAuthContext();
      setState({
        status: context.user ? 'authenticated' : 'anonymous',
        context,
        error: null,
      });
    } catch (error) {
      setState({ status: 'error', context: initialContext, error: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    const { data } = getSupabaseClient().auth.onAuthStateChange(() => {
      window.setTimeout(() => {
        void refresh();
      }, 0);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    await signOut();
    setState({ status: 'anonymous', context: initialContext, error: null });
  }, []);

  const value = useMemo(() => ({ ...state, refresh, logout }), [logout, refresh, state]);

  return <AuthStateContext.Provider value={value}>{children}</AuthStateContext.Provider>;
}
