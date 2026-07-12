import type { ReactNode } from 'react';
import { Button } from './Button';
import { CloseIcon } from './icons';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__head">
          <h3>{title}</h3>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
