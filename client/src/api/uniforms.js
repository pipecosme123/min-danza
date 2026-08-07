/**
 * Recurso de uniformes y su configuración por día de semana.
 * Ver `uniforms.routes.js` en el backend.
 */
import { apiClient } from './client.js';

export function getUniforms() {
  return apiClient.get('/uniforms');
}

export function createUniform(data) {
  return apiClient.post('/uniforms', data);
}

export function updateUniform(id, data) {
  return apiClient.patch(`/uniforms/${id}`, data);
}

/** @returns {Promise<Array<{weekday: string, uniformId: string}>>} */
export function getWeekdayUniforms() {
  return apiClient.get('/uniforms/weekday-config');
}

export function updateWeekdayUniform(weekday, uniformId) {
  return apiClient.patch(`/uniforms/weekday-config/${weekday}`, { uniformId });
}
