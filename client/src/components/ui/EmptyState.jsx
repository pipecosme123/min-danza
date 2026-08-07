import './EmptyState.css';

/**
 * Estado vacío estándar: título + descripción en lenguaje llano + acción
 * opcional para guiar el siguiente paso (ej. "Importar personas"). Se usa
 * en toda la app en vez de dejar una tabla o sección en blanco sin
 * explicación.
 */
export function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {description ? <p className="empty-state__description">{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
