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
 * @property {string|null} [cancelledAt] ISO string si el evento (siempre `EXTRAORDINARY`) fue cancelado; `null`/ausente si no.
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

/**
 * Asigna o limpia el uniforme de UN turno puntual (`FIXED`, `YOUTH_SERVICE` o
 * `EXTRAORDINARY`). No existe un endpoint de "asignar a una fecha completa":
 * cuando el turno es `FIXED`, quien llama es responsable de invocar esta
 * función para cada `ServiceSlot` `FIXED` que comparta la misma fecha (a lo
 * sumo 2 por día), para que ambos servicios queden con el mismo uniforme.
 * Ver `docs/architecture/phase4b-schedule-refinements-contract.md` §1.3/§1.5.
 * @param {string} slotId
 * @param {string|null} uniformId `null` limpia el uniforme del turno.
 * @returns {Promise<{ slot: ServiceSlotDto }>}
 */
export function updateSlotUniform(slotId, uniformId) {
  return apiClient.patch(`/slots/${slotId}`, { uniformId });
}

/**
 * Edita un evento extraordinario existente sin borrarlo/recrearlo (mismo id
 * antes y después). Body parcial: cualquier campo omitido no se toca;
 * `uniformId: null` limpia el uniforme del evento.
 * @param {string} eventId
 * @param {{ date?: string, startTime?: string, title?: string, teamsNeeded?: 1|2, uniformId?: string|null }} data
 * @returns {Promise<{ slot: ServiceSlotDto }>}
 */
export function updateEvent(eventId, data) {
  return apiClient.patch(`/events/${eventId}`, data);
}

/**
 * Cancela un evento extraordinario sin eliminarlo: el turno queda registrado
 * y visible (con `cancelledAt` no nulo), deja de necesitar equipo (sus
 * `SlotAssignment` se limpian) y deja de contar en el balance. A diferencia
 * de `deleteEvent`, es reversible en el sentido de que el evento sigue
 * existiendo para consulta; no hay forma de "descancelarlo" en esta fase.
 * Distinto de `updateEvent`/`deleteEvent` en los códigos de error que puede
 * devolver (`MES_PASADO` en vez de `MES_FINALIZADO` cuando el mes ya
 * finalizado es actual/futuro, `EVENTO_YA_CANCELADO` si ya estaba
 * cancelado). Contrato: `docs/architecture/phase4c-post-publish-edits-contract.md` §4.
 * @param {string} eventId
 * @returns {Promise<{ slot: ServiceSlotDto }>}
 */
export function cancelEvent(eventId) {
  return apiClient.post(`/events/${eventId}/cancel`);
}

/**
 * Cancela el turno `YOUTH_SERVICE` del mes sin eliminar el equipo `YOUTH`:
 * el turno queda registrado y visible (con `cancelledAt` no nulo), deja de
 * necesitar equipo y de contar en el balance, pero el equipo `YOUTH` y sus
 * integrantes se conservan (a diferencia de `deleteYouthTeam` en
 * `api/months.js`, que sí los elimina). Mismos códigos de error que
 * `cancelEvent` en su naturaleza (`MES_PASADO`), más
 * `SERVICIO_JOVENES_NO_ENCONTRADO`/`SERVICIO_JOVENES_YA_CANCELADO`.
 * @param {string} monthId
 * @returns {Promise<{ slot: ServiceSlotDto }>}
 */
export function cancelYouthService(monthId) {
  return apiClient.post(`/months/${monthId}/youth-team/cancel`);
}

/**
 * Finaliza el mes: pasa `status` a `FINALIZED` y fija `finalizedAt`. A partir
 * de ahí el mes queda visible en la página pública y se vuelve inmutable (ya
 * no admite sorteos, ediciones de equipos, cambios de horario ni eventos).
 * No hay forma de deshacer esta acción en esta fase (no existe
 * "des-finalizar"). Contrato: `docs/architecture/phase5-public-page-contract.md` §1.
 * @param {string} monthId
 * @returns {Promise<import('./months.js').MonthCycle>} el mismo DTO de `MonthCycle` de siempre, con `finalizedAt` ya no nulo.
 */
export function finalizeMonth(monthId) {
  return apiClient.post(`/months/${monthId}/finalize`);
}
