import type { ReactNode } from 'react';

import type { AppIconName } from '../../navigation/route-config';
import { Icon } from '../ui/Icon';

export function OperationalPageHeader({
  action,
  description,
  eyebrow,
  icon,
  title,
}: {
  action?: ReactNode;
  description: string;
  eyebrow: string;
  icon: AppIconName;
  title: string;
}) {
  return (
    <header className="page-heading operational-heading">
      <div>
        <span className="page-heading__eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ?? (
        <span className="module-badge">
          <Icon name={icon} size={18} /> Dados do backend
        </span>
      )}
    </header>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`record-status record-status--${tone}`}>{children}</span>;
}

export function InlineError({ message }: { message: string | null }) {
  return message ? (
    <div className="inline-error" role="alert">
      <Icon name="warning" size={18} /> {message}
    </div>
  ) : null;
}
