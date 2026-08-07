import { useEffect, useId, useRef } from 'react';
import './Modal.css';

/**
 * Modal accesible de base. `ConfirmDialog` se construye sobre este mismo
 * componente (composición, no reescritura) para confirmar acciones
 * destructivas como re-sortear equipos.
 *
 * - Cierra con Escape y con click en el fondo.
 * - Al abrir, mueve el foco dentro del diálogo; al cerrar, lo devuelve a
 *   quien lo abrió.
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` para lectores de
 *   pantalla.
 *
 * @param {{ open: boolean, onClose: () => void, title: string }} props
 */
export function Modal({ open, onClose, title, children, footer }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current = document.activeElement;
    const dialogNode = dialogRef.current;
    const focusable = dialogNode?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable || dialogNode)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="modal__body">{children}</div>

        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
