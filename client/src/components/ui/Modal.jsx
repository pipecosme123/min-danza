import { useEffect, useId, useRef } from 'react';
import './Modal.css';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Elementos que pueden recibir foco con Tab dentro de un contenedor, en orden de aparición. */
function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

/**
 * Modal accesible de base. `ConfirmDialog` se construye sobre este mismo
 * componente (composición, no reescritura) para confirmar acciones
 * destructivas como re-sortear equipos.
 *
 * - Cierra con Escape y con click en el fondo.
 * - Al abrir, mueve el foco dentro del diálogo; al cerrar, lo devuelve a
 *   quien lo abrió.
 * - Atrapa el foco: `Tab`/`Shift+Tab` circulan solo entre los elementos
 *   focalizables del diálogo, nunca hacia el contenido de fondo.
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` para lectores de
 *   pantalla.
 *
 * @param {{ open: boolean, onClose: () => void, title: string, size?: 'md'|'lg' }} props
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  // `onClose` casi siempre es una función nueva en cada render del padre
  // (inline o redeclarada dentro del componente). Se lee vía ref dentro del
  // listener de Escape para no tener que incluirla en las dependencias del
  // efecto de abajo — si estuviera ahí, cada tecleo en un campo del modal
  // dispararía el efecto de nuevo y devolvería el foco al botón «Cerrar»
  // (el primer elemento focalizable), cortando cualquier intento de escribir.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(dialogNode);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogNode.contains(document.activeElement)) {
        // El foco se salió del diálogo (ej. estaba en el fondo antes de abrir).
        event.preventDefault();
        first.focus();
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
    // Deliberadamente solo `open`: ver el comentario de `onCloseRef` arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`modal${size === 'lg' ? ' modal--lg' : ''}`}
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
