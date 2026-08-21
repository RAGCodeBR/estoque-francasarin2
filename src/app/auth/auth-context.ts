import { createContext, useContext } from 'react';

import type { AuthContext as DomainAuthContext } from '../../modules/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

export interface AuthProviderValue {
  status: AuthStatus;
  context: DomainAuthContext;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthStateContext = createContext<AuthProviderValue | null>(null);

export function useAuth(): AuthProviderValue {
  const value = useContext(AuthStateContext);
  if (!value) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.');
  return value;
}
