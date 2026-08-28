/**
 * Recurso "Versículo del mes": uno o más pasajes bíblicos (mismo libro y
 * capítulo, versión fija Reina Valera 1960) que el admin agrega mientras el
 * mes está editable. El backend resuelve el texto real una sola vez, al
 * agregarlo, y lo persiste — la página pública nunca depende de la fuente
 * externa. Contrato: plan `wise-noodling-hickey.md` Parte 4. Este módulo
 * solo serializa/deserializa HTTP; ninguna regla de negocio vive aquí.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} VersePassage
 * @property {string} id
 * @property {string} book
 * @property {number} chapter
 * @property {string} verses Rango tal como lo escribió el admin, ej. "16-18".
 * @property {string} version Fija por ahora: "RVR1960".
 * @property {string} text Texto resuelto y cacheado al agregarlo.
 * @property {string} reference Texto de referencia legible, ej. "Juan 3:16-18 (RVR1960)".
 */

/**
 * @param {string} monthId
 * @returns {Promise<{ verses: VersePassage[] }>}
 */
export function listVerses(monthId) {
  return apiClient.get(`/months/${monthId}/verses`);
}

/**
 * Agrega un versículo del mes: el servidor resuelve el texto vía scraping a
 * BibleGateway (RVR1960) y lo persiste. Puede fallar con
 * `VERSICULO_NO_ENCONTRADO` (la referencia no existe) o
 * `FUENTE_BIBLICA_NO_DISPONIBLE` (la fuente externa no respondió).
 * @param {string} monthId
 * @param {{ book: string, chapter: number, verses: string }} data
 * @returns {Promise<{ verse: VersePassage }>}
 */
export function addVerse(monthId, data) {
  return apiClient.post(`/months/${monthId}/verses`, data);
}

/**
 * Edita la referencia de un versículo ya agregado; si cambia libro/capítulo/
 * versículos, el servidor vuelve a resolver el texto.
 * @param {string} verseId
 * @param {{ book?: string, chapter?: number, verses?: string }} data
 * @returns {Promise<{ verse: VersePassage }>}
 */
export function updateVerse(verseId, data) {
  return apiClient.patch(`/verses/${verseId}`, data);
}

/**
 * @param {string} verseId
 * @returns {Promise<{ deleted: true }>}
 */
export function deleteVerse(verseId) {
  return apiClient.del(`/verses/${verseId}`);
}
