// Funciones de normalización de datos de persona, compartidas por TODOS los
// caminos de entrada del padrón: los esquemas zod de people.routes.js (alta
// individual / edición) y el parser de importPeople.service.js (carga
// masiva). Deben ser IDÉNTICAS en ambos (P8 del contrato de Fase 2,
// docs/architecture/phase2-people-contract.md) — si un dato es válido por un
// camino, tiene que serlo por el otro; si no, un mismo padrón daría
// resultados distintos según cómo se cargó.
//
// `nameKey` nunca se persiste (no hay columna `name_key` todavía, ver P8):
// se recalcula en memoria cada vez que hace falta comparar nombres.

/** Lo que se GUARDA en `fullName`: recorta bordes y colapsa espacios internos. */
export function normalizeName(s) {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Clave de comparación de nombres (NO se persiste). Mayúsculas sin tildes
 * para que "María" y "Maria" (o "MARIA") se traten como el mismo nombre.
 */
export function nameKey(s) {
  return normalizeName(s)
    .toLocaleUpperCase("es")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Lo que se GUARDA en `documentId`: mayúsculas sin espacios, puntos ni
 * guiones, de modo que "1.234.567" y "1234567" colisionen contra el mismo
 * índice único (`person_document_id_key`).
 */
export function normalizeDocument(s) {
  return s.trim().toUpperCase().replace(/[\s.-]/g, "");
}
