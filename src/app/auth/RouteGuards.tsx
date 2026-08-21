import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import type { AppPermission } from '../../modules/auth';
import { hasPermission } from '../../modules/auth';
import { ErrorState } from '../components/feedback/ErrorState';
import { LoadingState } from '../components/feedback/LoadingState';
import { useAuth } from './auth-context';

export function RequireSession({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <LoadingState />;
  if (auth.status === 'error') {
    return (
      <main className="fatal-error-page">
        <ErrorState
          description={auth.error ?? 'Não foi possível verificar a sessão.'}
          onRetry={() => {
            void auth.refresh();
          }}
        />
      </main>
    );
  }
  if (auth.status !== 'authenticated') {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  return children;
}

export function RequirePermission({
  children,
  permission,
}: {
  children: ReactNode;
  permission: AppPermission;
}) {
  const { context } = useAuth();

  if (!hasPermission(context.roles, permission)) {
    return (
      <section className="page-surface">
        <ErrorState
          description="Seu perfil não possui a permissão necessária para acessar este módulo."
          title="Acesso restrito"
        />
      </section>
    );
  }

  return children;
}

export function AnonymousOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <LoadingState />;
  if (auth.status === 'authenticated') return <Navigate replace to="/dashboard" />;
  return children;
}
