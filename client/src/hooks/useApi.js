import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Envuelve una función async de `api/` con estado estándar de
 * loading/error/data, para no repetir ese patrón en cada página
 * (PeopleManager, TeamGenerator, EventsManager, ...).
 *
 * Uso manual (ej. envío de un formulario):
 *   const { execute, loading, error } = useApi(login);
 *   await execute(username, password);
 *
 * Uso automático al montar (ej. cargar un listado):
 *   const { data, loading, error, execute: refetch } = useApi(getPeople, { immediate: true });
 */
export function useApi(apiFunction, { immediate = false, args = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const fnRef = useRef(apiFunction);
  fnRef.current = apiFunction;

  const execute = useCallback(async (...callArgs) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current(...callArgs);
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (immediate) {
      execute(...args).catch(() => {
        // el error ya queda expuesto en el estado `error`; no hay nada más
        // que hacer aquí, evitamos una excepción no controlada en consola.
      });
    }
    // Solo se ejecuta al montar: `args` se captura de la primera llamada a
    // propósito, igual que un array de dependencias vacío de useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate]);

  return { data, error, loading, execute, setData };
}
