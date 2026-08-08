/**
 * Recurso de horario mensual (turnos fijos + Servicio de jóvenes) y eventos
 * extraordinarios. Contrato cerrado:
 * `docs/architecture/phase4-schedule-contract.md`. Este módulo solo
 * serializa/deserializa HTTP; ninguna regla de negocio vive aquí.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} ScheduleTeamRef
 * @property {string} id `Team.id` asignado a este turno.
 * @property {string} label
 * @property {string} assignmentId `SlotAssignment.id` — necesario para `updateAssignment`.
 * @property {boolean} locked
 */

/**
 * @typedef {Object} ServiceSlotDto
 * @property {string} id
 * @property {string} date "YYYY-MM-DD"
 * @property {string} startTime "HH:mm"
 * @property {'FIXED'|'EXTRAORDINARY'|'YOUTH_SERVICE'} slotType
 * @property {string|null} title
 * @property {number} teamsNeeded
 * @property {boolean} countsTowardBalance
 * @property {{id: string, name: string, colorHex: string|null}|null} uniform
 * @property {ScheduleTeamRef[]} teams
 */

/**
 * Genera (o regenera) el horario completo del mes: turnos fijos de
 * miércoles/domingo y, si el mes tiene equipo de jóvenes, el slot del
 * Servicio de jóvenes. Sin `regenerate` (o `regenerate: false`), la llamada
 * es idempotente: si el mes ya tiene horario, lo devuelve tal cual sin
 * tocar nada. Con `regenerate: true` borra TODO el horario existente
 * (incluidos los eventos extraordinarios creados a mano) y lo vuelve a
 * generar desde cero.
 * @param {string} monthId
 * @param {{ regenerate?: boolean }} [data]
 * @returns {Promise<{ slots: ServiceSlotDto[], warnings: Array<{ code: string, message: string }> }>}
 */
export function generateSchedule(monthId, data = {}) {
  return apiClient.post(`/months/${monthId}/generate-schedule`, data);
}

/**
 * Lectura del horario ya generado con el balance de participaciones. Si el
 * mes todavía no tiene horario, devuelve `{ slots: [], balance: [] }` (no es
 * un error).
 * @param {string} monthId
 * @returns {Promise<{ slots: ServiceSlotDto[], balance: Array<{ teamId: string, label: string, count: number }> }>}
 */
export function getMonthSchedule(monthId) {
  return apiClient.get(`/months/${monthId}/schedule`);
}

/**
 * Crea un evento extraordinario dentro del mes (requiere que el horario
 * base ya esté generado). El backend asigna automáticamente el/los equipos
 * que mantengan el balance.
 * @param {string} monthId
 * @param {{ date: string, startTime: string, title: string, teamsNeeded: 1|2, uniformId?: string }} data
 * @returns {Promise<{ slot: ServiceSlotDto }>}
 */
export function createEvent(monthId, data) {
  return apiClient.post(`/months/${monthId}/events`, data);
}

/**
 * Elimina un evento extraordinario (no aplica a turnos `FIXED` ni al
 * `YOUTH_SERVICE`, el servidor lo rechaza para esos casos).
 * @param {string} eventId
 * @returns {Promise<{ deleted: true }>}
 */
export function deleteEvent(eventId) {
  return apiClient.del(`/events/${eventId}`);
}

/**
 * Bloquea/desbloquea una asignación o reasigna a mano el equipo de un turno.
 * Reasignar `teamId` fuerza `locked: true` en el servidor automáticamente.
 * @param {string} assignmentId
 * @param {{ locked?: boolean, teamId?: string }} data
 * @returns {Promise<{ assignment: { id: string, serviceSlotId: string, teamId: string, slotIndex: number, locked: boolean } }>}
 */
export function updateAssignment(assignmentId, data) {
  return apiClient.patch(`/assignments/${assignmentId}`, data);
}
