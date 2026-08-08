import { Button } from './Button.jsx';
import './Pagination.css';

/**
 * Números de página a mostrar alrededor de la página actual, con "…" para
 * los huecos. Siempre incluye la primera y la última página. Ej. con
 * current=7, total=20 → [1, '…', 6, 7, 8, '…', 20].
 *
 * @param {number} current
 * @param {number} total
 * @param {number} [delta] cuántas páginas mostrar a cada lado de la actual
 */
function getPageItems(current, total, delta = 1) {
  const pages = [];
  for (let i = 1; i <= total; i += 1) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      pages.push(i);
    }
  }

  const items = [];
  let previous;
  for (const page of pages) {
    if (previous !== undefined) {
      if (page - previous === 2) {
        items.push(previous + 1);
      } else if (page - previous > 2) {
        items.push('…');
      }
    }
    items.push(page);
    previous = page;
  }
  return items;
}

/**
 * Control de paginación genérico (usado por `PeopleManager` y, a futuro,
 * cualquier otra tabla paginada: eventos, equipos). No conoce el dominio,
 * solo números — mismo principio que `Table`. Incluye Anterior/Siguiente y
 * botones numéricos (con "…" para rangos largos) para saltar directo a una
 * página.
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
  const safeTotalPages = Math.max(totalPages, 1);
  const pageItems = getPageItems(page, safeTotalPages);

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

        <ul className="pagination__pages">
          {pageItems.map((item, index) =>
            item === '…' ? (
              // eslint-disable-next-line react/no-array-index-key
              <li key={`ellipsis-${index}`} className="pagination__ellipsis" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  className="pagination__page-button"
                  aria-current={item === page ? 'page' : undefined}
                  aria-label={`Ir a la página ${item}`}
                  disabled={item === page}
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </button>
              </li>
            ),
          )}
        </ul>

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
