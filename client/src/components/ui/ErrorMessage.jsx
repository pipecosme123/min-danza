import { Button } from './Button.jsx';
import './ErrorMessage.css';

/**
 * Mensaje de error en lenguaje llano, con acción de reintento visible
 * cuando aplica (ayuda a recuperarse del error en vez de dejar al usuario
 * varado). `role="alert"` para que se anuncie de inmediato.
 */
export function ErrorMessage({ message = 'Ocurrió un problema. Intenta de nuevo.', onRetry, retryLabel = 'Reintentar' }) {
  return (
    <div className="error-message" role="alert">
      <p className="error-message__text">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
