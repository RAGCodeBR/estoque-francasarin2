import { useState } from 'react';
import { Outlet } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const { context, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo-principal">
        Ir para o conteúdo principal
      </a>
      <Sidebar
        onClose={() => {
          setMenuOpen(false);
        }}
        open={menuOpen}
        roles={context.roles}
      />
      <div className="app-shell__main">
        <Header
          email={context.user?.email ?? 'Usuário'}
          onLogout={logout}
          onMenuOpen={() => {
            setMenuOpen(true);
          }}
          roles={context.roles}
        />
        <main className="page-container" id="conteudo-principal">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
