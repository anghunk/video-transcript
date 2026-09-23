import { useEffect } from 'react';
import { LoaderCircle, Timer, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: 'default' | 'danger';
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose?: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'default',
  busy = false,
  busyLabel = '处理中',
  onConfirm,
  onCancel,
  onClose,
}: ConfirmDialogProps) {
  const handleClose = onClose ?? onCancel;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      handleClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, handleClose]);

  return (
    <div className="confirm-backdrop" role="presentation" onMouseDown={handleClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="confirm-close" onClick={handleClose} aria-label="关闭" title="关闭">
          <X size={16} />
        </button>
        <div className="confirm-icon"><Timer size={22} /></div>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="confirm-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            type="button"
            className={`primary-button${confirmVariant === 'danger' ? ' danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
