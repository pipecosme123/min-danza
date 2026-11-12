import { Button } from './Button.jsx';
import { Modal } from './Modal.jsx';
import './Filters.css';

/**
 * Botón que abre el modal de filtros. Muestra cuántos filtros hay aplicados
 * para que se note que la tabla está filtrada aunque los chips queden fuera
 * de la vista.
 *
 * @param {{ count: number, onClick: () => void }} props
 */
export function FilterButton({ count, onClick }) {
  return (
    <Button variant="secondary" onClick={onClick} className="filter-button" aria-haspopup="dialog">
      <svg className="filter-button__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      Filtros
      {count > 0 ? (
        <span className="filter-button__count">
          {count}
          <span className="visually-hidden"> {count === 1 ? 'filtro aplicado' : 'filtros aplicados'}</span>
        </span>
      ) : null}
    </Button>
  );
}

/**
 * Modal con todos los filtros de una tabla. Los campos (children) editan un
 * borrador; nada se aplica hasta «Filtrar», que aplica todos a la vez.
 * «Limpiar» vacía el borrador sin cerrar el modal.
 *
 * @param {{ open: boolean, onClose: () => void, onApply: () => void, onClear: () => void, title?: string }} props
 */
export function FilterModal({ open, onClose, onApply, onClear, title = 'Filtros', children }) {
  function handleSubmit(event) {
    event.preventDefault();
    onApply();
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} noValidate className="filter-modal">
        <div className="filter-modal__fields">{children}</div>
        <div className="filter-modal__actions">
          <Button type="button" variant="ghost" onClick={onClear}>
            Limpiar
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit">Filtrar</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Chips de los filtros aplicados, encima de la tabla. Cada chip se quita por
 * separado; «Quitar todos» limpia el conjunto completo.
 *
 * @param {{ chips: { key: string, label: string }[], onRemove: (key: string) => void, onClearAll: () => void }} props
 */
export function FilterChips({ chips, onRemove, onClearAll }) {
  if (chips.length === 0) return null;

  return (
    <div className="filter-chips" role="region" aria-label="Filtros aplicados">
      <ul className="filter-chips__list">
        {chips.map((chip) => (
          <li key={chip.key} className="filter-chip">
            <span className="filter-chip__label">{chip.label}</span>
            <button
              type="button"
              className="filter-chip__remove"
              onClick={() => onRemove(chip.key)}
              aria-label={`Quitar filtro ${chip.label}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      {chips.length > 1 ? (
        <button type="button" className="filter-chips__clear" onClick={onClearAll}>
          Quitar todos
        </button>
      ) : null}
    </div>
  );
}
