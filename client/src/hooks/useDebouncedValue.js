import { useEffect, useState } from 'react';

/**
 * Devuelve `value` retrasado `delayMs` desde el último cambio. Pensado para
 * buscadores conectados a la API (ej. `PeopleManager`): evita disparar una
 * petición por cada tecla mientras la persona todavía está escribiendo.
 *
 * @template T
 * @param {T} value
 * @param {number} [delayMs]
 * @returns {T}
 */
export function useDebouncedValue(value, delayMs = 400) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
