import { Link } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { Icon } from '../components/ui/Icon';
import { routesForRoles } from '../navigation/route-config';

export function DashboardPage() {
  const { context } = useAuth();
  const quickRoutes = routesForRoles(context.roles)
    .filter((route) => route.path !== '/dashboard')
    .slice(0, 6);

  return (
    <div className="page-stack">
      <header className="page-heading page-heading--dashboard">
        <div>
          <span className="page-heading__eyebrow">VISÃO GERAL</span>
          <h1>Olá, vamos cuidar do estoque.</h1>
          <p>Acesse os módulos liberados para o seu perfil e mantenha toda operação rastreável.</p>
        </div>
        <span className="date-chip">
          <span className="status-dot" /> Sistema conectado
        </span>
      </header>

      <section aria-label="Princípios da operação" className="foundation-grid">
        <article className="foundation-card foundation-card--accent">
          <span className="foundation-card__icon">
            <Icon name="inventory" />
          </span>
          <div>
            <span>SALDO PROTEGIDO</span>
            <h2>Movimentações transacionais</h2>
            <p>Nenhuma tela altera o saldo diretamente.</p>
          </div>
        </article>
        <article className="foundation-card">
          <span className="foundation-card__icon">
            <Icon name="history" />
          </span>
          <div>
            <span>RASTREABILIDADE</span>
            <h2>Histórico permanente</h2>
            <p>Usuário, data e referência acompanham cada operação.</p>
          </div>
        </article>
        <article className="foundation-card">
          <span className="foundation-card__icon">
            <Icon name="settings" />
          </span>
          <div>
            <span>SEU ACESSO</span>
            <h2>{context.roles.length > 0 ? context.roles.join(' · ') : 'Sem papel atribuído'}</h2>
            <p>Rotas visíveis respeitam as permissões do seu perfil.</p>
          </div>
        </article>
      </section>

      <section className="page-surface quick-access">
        <div className="section-heading">
          <div>
            <span>ATALHOS</span>
            <h2>Acesso rápido</h2>
          </div>
          <p>Os módulos completos serão adicionados nos próximos blocos.</p>
        </div>
        <div className="quick-access__grid">
          {quickRoutes.map((route) => (
            <Link className="quick-link" key={route.path} to={route.path}>
              <span className="quick-link__icon">
                <Icon name={route.icon} />
              </span>
              <span>
                <strong>{route.label}</strong>
                <small>{route.eyebrow}</small>
              </span>
              <span aria-hidden="true" className="quick-link__arrow">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
