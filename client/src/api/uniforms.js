/**
 * Recurso de uniformes: CRUD puro. Contrato cerrado:
 * `docs/architecture/phase4b-schedule-refinements-contract.md` §1.4 (los
 * endpoints de configuración automática por día de semana / Servicio de
 * jóvenes se eliminaron por completo — cada turno lleva su propio uniforme,
 * asignado a mano desde `EventsManager` vía `api/schedule.js`). Este módulo
 * solo serializa/deserializa HTTP; ninguna regla de negocio vive aquí.
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
