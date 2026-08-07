// Esqueleto de caché en memoria del proceso, pensado para el endpoint
// público GET /api/schedule/:year/:month (Fase 5). Aún sin uso real en
// Fase 1 — se deja aquí para que el contrato quede fijado desde el inicio y
// las escrituras administrativas (generar equipos, recalcular balance, crear
// evento, editar asignación) sepan explícitamente qué invalidar.
//
// Empieza simple (Map en memoria) a propósito: no se introduce Redis salvo
// que el volumen de tráfico lo justifique (ver CLAUDE.md, sección Caché).

const store = new Map();

/**
 * @param {string} key
 * @returns {any | undefined}
 */
export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlMs] tiempo de vida en milisegundos; sin valor = sin expiración hasta invalidación explícita.
 */
export function setCached(key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: typeof ttlMs === "number" ? Date.now() + ttlMs : null,
  });
}

/**
 * Invalida una clave puntual (ej. el mes que se acaba de finalizar).
 * @param {string} key
 */
export function invalidateCached(key) {
  store.delete(key);
}

/**
 * Invalida todas las claves que empiecen con un prefijo (ej. "schedule:").
 * Útil para invalidar el caché público tras cualquier escritura administrativa
 * que afecte la organización del mes.
 * @param {string} prefix
 */
export function invalidateByPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

export function clearCache() {
  store.clear();
}
