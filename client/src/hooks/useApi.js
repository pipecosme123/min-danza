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
  // Una vez que ya hubo datos, un refetch (ej. después de una acción como
  // bloquear/reasignar/cambiar uniforme) NO vuelve a poner `loading` en
  // true: si lo hiciera, cada pantalla que condiciona su contenido a
  // `!loading` (la inmensa mayoría) desmontaría toda la vista y mostraría
  // el spinner de carga inicial, lo que se siente como que "la página se
  // refresca y salta al principio" en cada modificación. `loading` queda
  // reservado para la primera carga; refetches posteriores actualizan
  // `data`/`error` sin ocultar el contenido ya mostrado.
  const hasLoadedRef = useRef(false);

  const execute = useCallback(async (...callArgs) => {
    const isFirstLoad = !hasLoadedRef.current;
    if (isFirstLoad) setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current(...callArgs);
      hasLoadedRef.current = true;
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      if (isFirstLoad) setLoading(false);
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
