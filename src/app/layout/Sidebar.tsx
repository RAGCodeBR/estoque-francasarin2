import { NavLink } from 'react-router';

import type { AppRole } from '../../modules/auth';
import { Icon } from '../components/ui/Icon';
import { ROUTE_SECTIONS, routesForRoles } from '../navigation/route-config';
import { Brand } from './Brand';

interface SidebarProps {
  roles: readonly AppRole[];
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ onClose, open, roles }: SidebarProps) {
  const allowedRoutes = routesForRoles(roles);

  return (
    <>
      <button
        aria-label="Fechar menu"
        className={`sidebar-backdrop ${open ? 'sidebar-backdrop--visible' : ''}`}
        onClick={onClose}
        type="button"
      />
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand-row">
          <Brand />
          <button
            aria-label="Fechar menu"
            className="icon-button sidebar__close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav aria-label="Navegação principal" className="sidebar__nav">
          {ROUTE_SECTIONS.map((section) => {
            const sectionRoutes = allowedRoutes.filter((route) => route.section === section);
            if (sectionRoutes.length === 0) return null;

            return (
              <div className="nav-section" key={section}>
                <span className="nav-section__label">{section}</span>
                <div className="nav-section__items">
                  {sectionRoutes.map((route) => (
                    <NavLink
                      className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
                      end
                      key={route.path}
                      onClick={onClose}
                      to={route.path}
                    >
                      <Icon name={route.icon} size={19} />
                      <span>{route.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <span className="status-dot" />
          <div>
            <strong>Ambiente conectado</strong>
            <span>Protegido pelo Supabase</span>
          </div>
        </div>
      </aside>
    </>
  );
}
