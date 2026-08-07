/**
 * Recurso de autenticación.
 *
 * Nota de alcance: el documento de diseño (`docs/architecture/phase1-schema-design.md`,
 * sección 4) no lista `api/auth.js` explícitamente entre los archivos de
 * `/client/src/api`, pero `AuthContext` necesita una función real de login
 * contra `POST /api/auth/login` (ver tarea de Fase 1, punto 5). Se agrega de
 * forma aditiva siguiendo el mismo patrón "un archivo por recurso".
 */
import { apiClient } from './client.js';

/**
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ token: string, admin: { username: string, displayName?: string } }>}
 */
export function login(username, password) {
  return apiClient.post('/auth/login', { username, password });
}
