/**
 * Recurso de ciclos mensuales y generación de equipos.
 * Ver `months.routes.js` / `teams.routes.js` / `events.routes.js` en el backend.
 * Sin lógica de negocio en esta fase: solo la forma del contrato HTTP.
 */
import { apiClient } from './client.js';

export function getMonths() {
  return apiClient.get('/months');
}

export function getMonth(id) {
  return apiClient.get(`/months/${id}`);
}

export function createMonth({ year, month, teamCount }) {
  return apiClient.post('/months', { year, month, teamCount });
}

export function generateTeams(monthId) {
  return apiClient.post(`/months/${monthId}/generate-teams`);
}

export function createExtraordinaryEvent(monthId, data) {
  return apiClient.post(`/months/${monthId}/events`, data);
}

export function deleteExtraordinaryEvent(monthId, eventId) {
  return apiClient.del(`/months/${monthId}/events/${eventId}`);
}
