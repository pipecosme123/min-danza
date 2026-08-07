import { useToast } from '../../hooks/useToast.js';
import './Toast.css';

const VARIANT_LABELS = {
  success: 'Éxito',
  error: 'Error',
  info: 'Aviso',
};

/**
 * Renderiza las notificaciones producidas por `useToast` (guardar, generar
 * equipos, importar personas, etc.). Se monta una sola vez en `App.jsx`.
 *
 * Nota de alcance: el documento de diseño (phase1-schema-design.md, §4) pide
 * `hooks/useToast.js` pero no especifica dónde se renderizan los toasts.
 * Se agrega este componente de forma aditiva, siguiendo el mismo patrón que
 * el resto de `ui/`, porque un estado de éxito/error "siempre visible" es
 * mandato explícito del perfil de usuario (ver CLAUDE.md).
 */
export function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-viewport" role="region" aria-label="Notificaciones">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
        >
          <span className="toast__label">{VARIANT_LABELS[toast.variant] || VARIANT_LABELS.info}:</span>
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            onClick={() => dismissToast(toast.id)}
            aria-label="Cerrar notificación"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}
