/**
 * Recurso de personas (padrón). Ver `people.routes.js` en el backend.
 * Todavía sin backend real disponible: estas funciones están listas para
 * usarse desde `PeopleManager` y fallan limpiamente (ApiError) hasta que el
 * servidor exista.
 */
import { apiClient } from './client.js';

/** @returns {Promise<Array<{id: string, fullName: string, documentId: string|null, category: 'ELEGIBLE_LIDER'|'COLABORADOR', active: boolean}>>} */
export function getPeople() {
  return apiClient.get('/people');
}

export function createPerson(data) {
  return apiClient.post('/people', data);
}

export function updatePerson(id, data) {
  return apiClient.patch(`/people/${id}`, data);
}

export function deactivatePerson(id) {
  return apiClient.del(`/people/${id}`);
}

/**
 * Carga masiva de personas vía CSV/Excel.
 * @param {File} file
 */
export function importPeople(file) {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post('/people/import', formData);
}
