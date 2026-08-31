import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

export function Modal({
  title,
  children,
  onClose,
  busy = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const node = ref.current;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    node?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      node?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={`modal ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={headingId}>{title}</h2>
        <IconButton label="閉じる" onClick={onClose} disabled={busy}>
          <X size={18} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
