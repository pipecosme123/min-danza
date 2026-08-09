/**
 * Lectura PÚBLICA (sin autenticación) del mes finalizado más reciente.
 * Contrato cerrado: `docs/architecture/phase5-public-page-contract.md` §2-3.
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
 * horario, sin balance de participaciones ni ningún dato administrativo). La
 * página pública muestra solo este mes, sin selector ni historial (decisión
 * confirmada, ver el contrato).
 * @returns {Promise<PublicSchedulePayload>}
 * @throws {import('./client.js').ApiError} 404 con `details.code === 'MES_NO_PUBLICADO'` si todavía no hay ningún mes finalizado.
 */
export function getLatestPublicSchedule() {
  return apiClient.get('/schedule/latest');
}
