/**
 * Recurso de eventos agrupados ("Congreso" es el ejemplo, pero es genérico:
 * cualquier evento con 2 o más fechas y uno o más turnos por fecha, con
 * equipos elegidos a mano). Contrato: plan `wise-noodling-hickey.md` Parte 2.
 * Cada "turno" de un grupo es, por dentro, un `ServiceSlot` normal
 * (`slotType: EXTRAORDINARY`) con `eventGroupId`, por eso su forma es la
 * misma `ServiceSlotDto` que ya expone `api/schedule.js`. Este módulo solo
 * serializa/deserializa HTTP; ninguna regla de negocio vive aquí.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} EventGroupTurnoInput
 * @property {string} date "YYYY-MM-DD"
 * @property {string} startTime "HH:mm"
 * @property {string[]} teamIds Equipos `REGULAR` del mes, elegidos a mano (no auto-balanceados).
 * @property {string} [uniformId]
 */

/**
 * @typedef {Object} EventGroupDto
 * @property {string} id
 * @property {string} title
 * @property {import('./schedule.js').ServiceSlotDto[]} slots Turnos del grupo, cada uno un `ServiceSlot` normal con `eventGroupId`.
 */

/**
 * Crea un evento agrupado nuevo: al menos 2 fechas distintas entre sus
 * turnos, cada turno con uno o más equipos elegidos a mano. Requiere que el
 * horario base del mes ya esté generado.
 * @param {string} monthId
 * @param {{ title: string, turnos: EventGroupTurnoInput[] }} data
 * @returns {Promise<{ group: EventGroupDto }>}
 */
export function createEventGroup(monthId, data) {
  return apiClient.post(`/months/${monthId}/event-groups`, data);
}

/**
 * Lista los eventos agrupados del mes, con sus turnos anidados.
 * @param {string} monthId
 * @returns {Promise<{ groups: EventGroupDto[] }>}
 */
export function listEventGroups(monthId) {
  return apiClient.get(`/months/${monthId}/event-groups`);
}

/**
 * Renombra un evento agrupado (el título se aplica también a cada uno de sus turnos).
 * @param {string} groupId
 * @param {string} title
 * @returns {Promise<{ group: EventGroupDto }>}
 */
export function updateEventGroupTitle(groupId, title) {
  return apiClient.patch(`/event-groups/${groupId}`, { title });
}

/**
 * Agrega un turno más a un evento agrupado ya existente (mismas validaciones que al crear el grupo).
 * @param {string} groupId
 * @param {EventGroupTurnoInput} data
 * @returns {Promise<{ slot: import('./schedule.js').ServiceSlotDto }>}
 */
export function addEventGroupTurno(groupId, data) {
  return apiClient.post(`/event-groups/${groupId}/turnos`, data);
}

/**
 * Edita un turno de un evento agrupado. Si viene `teamIds`, reemplaza el set
 * completo de equipos asignados a ese turno (no un ajuste incremental).
 * @param {string} slotId
 * @param {Partial<EventGroupTurnoInput>} data
 * @returns {Promise<{ slot: import('./schedule.js').ServiceSlotDto }>}
 */
export function updateEventGroupTurno(slotId, data) {
  return apiClient.patch(`/event-groups/turnos/${slotId}`, data);
}

/**
 * Elimina un turno suelto de un evento agrupado. Si era el último turno del
 * grupo, el servidor elimina también el grupo (no deja grupos vacíos).
 * @param {string} slotId
 * @returns {Promise<{ deleted: true }>}
 */
export function deleteEventGroupTurno(slotId) {
  return apiClient.del(`/event-groups/turnos/${slotId}`);
}

/**
 * Cancela TODOS los turnos de un evento agrupado a la vez (mismo mecanismo
 * que cancelar un evento suelto: quedan registrados y visibles, ya no
 * necesitan equipo ni cuentan en el balance). No hay forma de "descancelarlo".
 * @param {string} groupId
 * @returns {Promise<{ group: EventGroupDto }>}
 */
export function cancelEventGroup(groupId) {
  return apiClient.post(`/event-groups/${groupId}/cancel`);
}

/**
 * Elimina un evento agrupado completo (todos sus turnos, en cascada).
 * @param {string} groupId
 * @returns {Promise<{ deleted: true }>}
 */
export function deleteEventGroup(groupId) {
  return apiClient.del(`/event-groups/${groupId}`);
}
