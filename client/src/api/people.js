/**
 * Recurso de personas (padrón). Ver `docs/architecture/phase2-people-contract.md`
 * para el contrato completo (shapes de respuesta, códigos de error, reglas
 * de deduplicación). Este módulo solo serializa/deserializa HTTP; ninguna
 * regla de negocio vive aquí.
 */
import { apiClient } from './client.js';

/**
 * @typedef {Object} Person
 * @property {string} id
 * @property {string} fullName
 * @property {string|null} documentId
 * @property {'INSTRUCTOR'|'MINISTRO'} category
 * @property {boolean} isJoven Independiente de `category`: elegible para el pool de sorteo del equipo de jóvenes.
 * @property {boolean} isAdultoMayor Independiente de `category` y mutuamente excluyente con `isJoven`: pool que se reparte equitativamente entre los equipos regulares.
 * @property {boolean} active
 * @property {string|null} notes
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} PeopleQuery
 * @property {number} [page]
 * @property {number} [pageSize]
 * @property {string} [search]
 * @property {'INSTRUCTOR'|'MINISTRO'} [category]
 * @property {boolean} [active]
 * @property {boolean} [isJoven]
 * @property {boolean} [isAdultoMayor]
 * @property {'fullName'|'-fullName'|'createdAt'|'-createdAt'} [sort]
 */

/**
 * Lista paginada de personas. La API es neutral en `active` (sin filtro,
 * devuelve activos e inactivos); el llamador decide el default
 * (`PeopleManager` debe enviar `active: true` salvo que el admin active
 * "Ver inactivos", por acuerdo explícito del contrato).
 *
 * @param {PeopleQuery} [params]
 * @returns {Promise<{ data: Person[], pagination: { page: number, pageSize: number, total: number, totalPages: number } }>}
 */
export function getPeople(params = {}) {
  const query = new URLSearchParams();
  if (params.page != null) query.set('page', String(params.page));
  if (params.pageSize != null) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.active != null) query.set('active', String(params.active));
  if (params.isJoven != null) query.set('isJoven', String(params.isJoven));
  if (params.isAdultoMayor != null) query.set('isAdultoMayor', String(params.isAdultoMayor));
  if (params.sort) query.set('sort', params.sort);

  const queryString = query.toString();
  return apiClient.get(`/people${queryString ? `?${queryString}` : ''}`);
}

/**
 * @param {{ fullName: string, documentId?: string|null, category: 'INSTRUCTOR'|'MINISTRO', isJoven?: boolean, isAdultoMayor?: boolean, notes?: string|null, confirmDuplicateName?: boolean }} data
 * @returns {Promise<Person>}
 */
export function createPerson(data) {
  return apiClient.post('/people', data);
}

/**
 * @param {string} id
 * @param {Partial<{ fullName: string, documentId: string|null, category: 'INSTRUCTOR'|'MINISTRO', isJoven: boolean, isAdultoMayor: boolean, notes: string|null, active: boolean }>} data
 * @returns {Promise<{ person: Person, warnings: Array<{ code: string, message: string }> }>}
 */
export function updatePerson(id, data) {
  return apiClient.patch(`/people/${id}`, data);
}

/**
 * Baja lógica (comportamiento por defecto de `DELETE`, ver P17 del
 * contrato). Idempotente: dar de baja a alguien ya inactivo devuelve 200
 * con el mismo cuerpo.
 *
 * @param {string} id
 * @returns {Promise<{ person: Person, warnings: Array<{ code: string, message: string }> }>}
 */
export function deactivatePerson(id) {
  return apiClient.del(`/people/${id}`);
}

/**
 * Carga masiva de personas vía CSV/Excel.
 * @param {File} file
 * @returns {Promise<{
 *   fileName: string,
 *   summary: { totalRows: number, created: number, updated: number, skipped: number, failed: number, blankRowsIgnored: number, ignoredColumns: string[] },
 *   created: Array<{ row: number, personId: string, fullName: string, category: string }>,
 *   updated: Array<{ row: number, personId: string, fullName: string, changes: Record<string, { from: unknown, to: unknown }> }>,
 *   skipped: Array<{ row: number, code: string, personId: string|null, message: string }>,
 *   errors: Array<{ row: number, column: string|null, value: unknown, code: string, message: string }>,
 *   truncated: boolean,
 * }>}
 */
export function importPeople(file) {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post('/people/import', formData);
}
