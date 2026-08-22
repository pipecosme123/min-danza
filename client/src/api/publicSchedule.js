/**
 * Lectura PÚBLICA (sin autenticación) del horario finalizado: el mes más
 * reciente por defecto, y hasta 1 año de historial hacia atrás (ajustado
 * 2026-08-22). Contrato cerrado: `docs/architecture/phase5-public-page-contract.md` §2-3.
 * `apiClient` ya funciona sin token si no hay ninguno en `localStorage` (el
 * caso de un visitante sin sesión), no hace falta un cliente HTTP aparte.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} PublicSchedulePayload
 * @property {{ year: number, month: number, finalizedAt: string }} month
 * @property {import('./months.js').TeamDto[]} teams Ya ordenados por `orderIndex`, incluye el equipo `YOUTH` si el mes lo tiene.
 * @property {import('./schedule.js').ServiceSlotDto[]} slots Ya ordenados por fecha/hora.
 */

/**
 * Trae la organización pública del mes `FINALIZED` más reciente (equipos y
 * horario, sin balance de participaciones ni ningún dato administrativo).
 * Sin restricción de antigüedad -- siempre lo último publicado, sea cual sea
 * su fecha.
 * @returns {Promise<PublicSchedulePayload>}
 * @throws {import('./client.js').ApiError} 404 con `details.code === 'MES_NO_PUBLICADO'` si todavía no hay ningún mes finalizado.
 */
export function getLatestPublicSchedule() {
  return apiClient.get('/schedule/latest');
}

/**
 * Trae la organización pública de un mes `FINALIZED` puntual, dentro de la
 * ventana de historial (hasta 1 año de antigüedad desde hoy).
 * @param {number} year
 * @param {number} month
 * @returns {Promise<PublicSchedulePayload>}
 * @throws {import('./client.js').ApiError} 404 con `details.code === 'MES_NO_PUBLICADO'` si ese mes no existe, sigue en DRAFT, o está fuera de la ventana de 1 año -- nunca se distingue el motivo.
 */
export function getPublicScheduleFor(year, month) {
  return apiClient.get(`/schedule/${year}/${month}`);
}

/**
 * Lista los meses `FINALIZED` dentro de la ventana de historial pública
 * (hasta 1 año de antigüedad), para poblar el selector de "ver un mes
 * anterior". Nunca incluye meses `DRAFT`.
 * @returns {Promise<{ months: Array<{ year: number, month: number }> }>}
 */
export function getScheduleHistory() {
  return apiClient.get('/schedule/history');
}
