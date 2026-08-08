import { Button } from './Button.jsx';
import './Pagination.css';

/**
 * Control de paginación genérico (usado por `PeopleManager` y, a futuro,
 * cualquier otra tabla paginada: eventos, equipos). No conoce el dominio,
 * solo números — mismo principio que `Table`.
 *
 * @param {{
 *   page: number,
 *   totalPages: number,
 *   total: number,
 *   pageSize: number,
 *   onPageChange: (page: number) => void,
 * }} props
 */
export function Pagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (total === 0) return null;

  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="Paginación de resultados">
      <p className="pagination__summary">
        Mostrando {firstItem}–{lastItem} de {total}
      </p>
      <div className="pagination__controls">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Anterior
        </Button>
        <span className="pagination__page" aria-current="page">
          Página {page} de {Math.max(totalPages, 1)}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Siguiente
        </Button>
      </div>
    </nav>
  );
}
