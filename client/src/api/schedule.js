/**
 * Recurso público del horario. Sin autenticación.
 * Ver `schedule.routes.js` en el backend: `GET /api/schedule/:year/:month`.
 * Solo devuelve datos cuando el mes está FINALIZED (regla de negocio, ver
 * CLAUDE.md); en DRAFT el backend responde vacío/404 y la página pública
 * debe mostrar el estado "aún no publicado".
 */
import { apiClient } from './client.js';

export function getPublicSchedule(year, month) {
  return apiClient.get(`/schedule/${year}/${month}`);
}
