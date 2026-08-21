import { useEffect, useRef, type ReactNode } from 'react';

import { Icon } from './Icon';

interface DialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}

export function Dialog({ children, description, onClose, open, title }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={description ? 'dialog-description' : undefined}
      aria-labelledby="dialog-title"
      className="dialog"
      onCancel={onClose}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="dialog__heading">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {description ? <p id="dialog-description">{description}</p> : null}
        </div>
        <button aria-label="Fechar" className="icon-button" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
