import './Spinner.css';

/**
 * Indicador de carga. `role="status"` + texto accesible: el estado de
 * "cargando" debe anunciarse a lectores de pantalla, no solo verse.
 */
export function Spinner({ label = 'Cargando...', size = 'md' }) {
  return (
    <div className="spinner-wrapper" role="status">
      <span className={`spinner spinner--${size}`} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
