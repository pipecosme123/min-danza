/**
 * Recurso del portal de líderes (Fase 9). Todas las llamadas usan el token
 * del portal de líderes (`auth: 'leader'`), separado del token de admin.
 * Contrato: docs/architecture/phase9-attendance-reports-contract.md §5.1-5.2.
 * Este módulo solo serializa/deserializa HTTP; ninguna regla vive aquí.
 */
import { apiClient } from './client.js';

const LEADER = { auth: 'leader' };

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ token: string, leader: { id: string, fullName: string }, mustChangePassword: boolean }>}
 */
export function leaderLogin(username, password) {
  return apiClient.post('/leader/login', { username, password }, LEADER);
}

/** @returns {Promise<{ id, personId, fullName, username, mustChangePassword }>} */
export function getLeaderProfile() {
  return apiClient.get('/leader/me', LEADER);
}

/**
 * @param {{ currentPassword: string, newPassword: string }} data
 * @returns {Promise<{ changed: true }>}
 */
export function changeLeaderPassword(data) {
  return apiClient.post('/leader/change-password', data, LEADER);
}

/** Turnos asignados a los equipos que este líder lidera (ventana abierta o recién cerrada). */
export function getLeaderServices() {
  return apiClient.get('/leader/services', LEADER);
}

/** Buscador acotado de personas del padrón para los selectores «cubrió» / «apoyo». */
export function searchLeaderPeople(query) {
  const qs = query ? `?query=${encodeURIComponent(query)}` : '';
  return apiClient.get(`/leader/people${qs}`, LEADER);
}

/** Crea el borrador de un reporte (materializa el roster del equipo). */
export function createReportDraft(slotId, teamId) {
  return apiClient.post(`/leader/services/${slotId}/${teamId}/report`, undefined, LEADER);
}

export function getLeaderReport(reportId) {
  return apiClient.get(`/leader/reports/${reportId}`, LEADER);
}

/**
 * Guarda el borrador. Reemplaza el set completo de entries/supports.
 * @param {string} reportId
 * @param {{ entries?: any[], supports?: any[], generalNotes?: string|null }} body
 */
export function saveLeaderReport(reportId, body) {
  return apiClient.patch(`/leader/reports/${reportId}`, body, LEADER);
}

export function submitLeaderReport(reportId) {
  return apiClient.post(`/leader/reports/${reportId}/submit`, undefined, LEADER);
}

export function reopenLeaderReport(reportId) {
  return apiClient.post(`/leader/reports/${reportId}/reopen`, undefined, LEADER);
}

/** @returns {Promise<{ text: string }>} texto plano listo para compartir por WhatsApp. */
export function getLeaderWhatsappText(reportId) {
  return apiClient.get(`/leader/reports/${reportId}/whatsapp-text`, LEADER);
}
