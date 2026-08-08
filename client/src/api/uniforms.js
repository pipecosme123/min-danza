/**
 * Recurso de uniformes y su configuración (por día de semana y del Servicio
 * de jóvenes). Ver `uniforms.routes.js` en el backend y
 * `docs/architecture/phase4-schedule-contract.md` §7 para el contrato
 * completo. Este módulo solo serializa/deserializa HTTP; ninguna regla de
 * negocio vive aquí.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} Uniform
 * @property {string} id
 * @property {string} name
 * @property {string|null} colorHex
 * @property {string|null} description
 * @property {boolean} active
 */

/**
 * `GET /api/uniforms` devuelve `{ data: [...] }`; esta función desenvuelve
 * el array para que el resto de la app no tenga que conocer ese detalle de
 * transporte (todos los uniformes, activos e inactivos).
 * @returns {Promise<Uniform[]>}
 */
export async function getUniforms() {
  const response = await apiClient.get('/uniforms');
  return response?.data ?? [];
}

/**
 * @param {{ name: string, colorHex?: string, description?: string }} data
 * @returns {Promise<Uniform>}
 */
export function createUniform(data) {
  return apiClient.post('/uniforms', data);
}

/**
 * @param {string} id
 * @param {Partial<{ name: string, colorHex: string, description: string, active: boolean }>} data
 * @returns {Promise<Uniform>}
 */
export function updateUniform(id, data) {
  return apiClient.patch(`/uniforms/${id}`, data);
}

/**
 * Uniforme configurado para cada día de semana con turno fijo (miércoles y
 * domingo). `GET` devuelve `{ data: [...] }`; esta función desenvuelve el
 * array. Puede faltar alguno de los dos días si todavía no se configuró.
 * @returns {Promise<Array<{weekday: 'WEDNESDAY'|'SUNDAY', uniformId: string}>>}
 */
export async function getWeekdayUniforms() {
  const response = await apiClient.get('/uniforms/weekday-config');
  return response?.data ?? [];
}

/**
 * @param {'WEDNESDAY'|'SUNDAY'} weekday
 * @param {string} uniformId
 * @returns {Promise<{weekday: string, uniformId: string}>}
 */
export function updateWeekdayUniform(weekday, uniformId) {
  return apiClient.patch(`/uniforms/weekday-config/${weekday}`, { uniformId });
}

/**
 * Config del uniforme del Servicio de jóvenes (fila única/singleton, no
 * envuelta en `data`).
 * @returns {Promise<{ uniformId: string|null }>}
 */
export function getYouthServiceUniform() {
  return apiClient.get('/uniforms/youth-service-config');
}

/**
 * @param {string} uniformId
 * @returns {Promise<{ uniformId: string }>}
 */
export function updateYouthServiceUniform(uniformId) {
  return apiClient.patch('/uniforms/youth-service-config', { uniformId });
}
