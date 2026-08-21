import { useState } from 'react';

import type { AppRole } from '../../modules/auth';
import { useToast } from '../components/feedback/toast-context';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Icon } from '../components/ui/Icon';

const roleLabels: Record<AppRole, string> = {
  ADMIN: 'Administrador',
  STOCK_OPERATOR: 'Operador de estoque',
  VIEWER: 'Visualizador',
};

interface HeaderProps {
  email: string;
  roles: readonly AppRole[];
  onMenuOpen: () => void;
  onLogout: () => Promise<void>;
}

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export function Header({ email, onLogout, onMenuOpen, roles }: HeaderProps) {
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const primaryRole = roles[0];
  const { notify } = useToast();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
      setLogoutOpen(false);
    } catch {
      notify({
        title: 'Não foi possível encerrar a sessão',
        description: 'Tente novamente em alguns instantes.',
        tone: 'error',
      });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="topbar">
      <button
        aria-label="Abrir menu"
        className="icon-button topbar__menu"
        onClick={onMenuOpen}
        type="button"
      >
        <Icon name="menu" />
      </button>
      <div className="topbar__context">
        <span className="topbar__eyebrow">SISTEMA DE ESTOQUE</span>
        <strong>Operação do restaurante</strong>
      </div>
      <div className="topbar__actions">
        <button
          aria-label="Notificações"
          className="icon-button topbar__notification"
          onClick={() => {
            notify({
              title: 'Tudo certo por aqui',
              description: 'Você não possui novas notificações.',
            });
          }}
          type="button"
        >
          <Icon name="bell" size={19} />
          <span aria-hidden="true" />
        </button>
        <button
          className="profile-button"
          onClick={() => {
            setLogoutOpen(true);
          }}
          type="button"
        >
          <span className="profile-button__avatar">{initials(email)}</span>
          <span className="profile-button__copy">
            <strong>{email}</strong>
            <small>{primaryRole ? roleLabels[primaryRole] : 'Sem perfil atribuído'}</small>
          </span>
          <Icon name="chevron-down" size={17} />
        </button>
      </div>

      <Dialog
        description="Sua sessão neste navegador será encerrada com segurança."
        onClose={() => {
          setLogoutOpen(false);
        }}
        open={logoutOpen}
        title="Deseja sair do sistema?"
      >
        <div className="dialog__actions">
          <Button
            onClick={() => {
              setLogoutOpen(false);
            }}
            variant="secondary"
          >
            Continuar conectado
          </Button>
          <Button
            isLoading={loggingOut}
            onClick={() => {
              void handleLogout();
            }}
            variant="danger"
          >
            <Icon name="logout" size={18} />
            Sair do sistema
          </Button>
        </div>
      </Dialog>
    </header>
  );
}
