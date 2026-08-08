/**
 * Recurso de ciclo mensual y equipos. Ver
 * `docs/architecture/phase3-teams-contract.md` para el contrato completo
 * (shapes de respuesta, códigos de error, algoritmo de sorteo). Este módulo
 * solo serializa/deserializa HTTP; ninguna regla de negocio vive aquí.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} MonthCycle
 * @property {string} id
 * @property {number} year
 * @property {number} month 1..12
 * @property {number} teamCount
 * @property {'DRAFT'|'FINALIZED'} status
 * @property {string|null} finalizedAt
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} TeamMemberDto
 * @property {string} id `TeamMember.id`
 * @property {string} personId
 * @property {string} fullName
 * @property {'LEADER'|'SUPPORT'|'COLLABORATOR'} role
 * @property {boolean} manualOverride
 */

/**
 * @typedef {Object} TeamDto
 * @property {string} id
 * @property {string} label
 * @property {number} orderIndex
 * @property {TeamMemberDto[]} members
 */

/**
 * Lista simple de meses, sin paginación (orden: año/mes descendente, el más
 * reciente primero).
 * @returns {Promise<{ data: MonthCycle[] }>}
 */
export function getMonths() {
  return apiClient.get('/months');
}

/**
 * @param {{ year: number, month: number, teamCount: number }} data
 * @returns {Promise<MonthCycle>}
 */
export function createMonth(data) {
  return apiClient.post('/months', data);
}

/**
 * @param {string} id
 * @returns {Promise<MonthCycle>}
 */
export function getMonth(id) {
  return apiClient.get(`/months/${id}`);
}

/**
 * @param {string} id
 * @returns {Promise<{ teams: TeamDto[] }>}
 */
export function getMonthTeams(id) {
  return apiClient.get(`/months/${id}/teams`);
}

/**
 * Sortea (o re-sortea) líder/apoyo/ministros de todos los equipos del mes.
 * Destructivo: reemplaza por completo el sorteo anterior, incluidas
 * ediciones manuales previas.
 * @param {string} id
 * @returns {Promise<{ teams: TeamDto[], warnings: Array<{ code: string, message: string }> }>}
 */
export function generateTeams(id) {
  return apiClient.post(`/months/${id}/generate-teams`);
}

/**
 * Reemplaza el roster completo de un equipo puntual (mover gente entre
 * equipos, cambiar roles, promover manualmente).
 * @param {string} teamId
 * @param {{ members: Array<{ personId: string, role: 'LEADER'|'SUPPORT'|'COLLABORATOR' }> }} data
 * @returns {Promise<{ team: TeamDto }>}
 */
export function updateTeam(teamId, data) {
  return apiClient.patch(`/teams/${teamId}`, data);
}
