/**
 * Recurso administrativo «Accesos»: alta y gestión de las cuentas del portal
 * de líderes (Fase 9). Usa el token de admin. La contraseña temporal se
 * devuelve una sola vez, al crear la cuenta o al resetearla.
 * Contrato: docs/architecture/phase9-attendance-reports-contract.md §5.3.
 */
import { apiClient } from './client.js';

/** @returns {Promise<{ accounts: Array<object> }>} */
export function listLeaderAccounts() {
  return apiClient.get('/leader-accounts');
}

/**
 * @param {string} personId
 * @returns {Promise<{ account: object, tempPassword: string }>}
 */
export function createLeaderAccount(personId) {
  return apiClient.post('/leader-accounts', { personId });
}

/**
 * @param {string} accountId
 * @param {{ username?: string, active?: boolean }} data
 */
export function updateLeaderAccount(accountId, data) {
  return apiClient.patch(`/leader-accounts/${accountId}`, data);
}

/** @returns {Promise<{ tempPassword: string }>} */
export function resetLeaderPassword(accountId) {
  return apiClient.post(`/leader-accounts/${accountId}/reset-password`);
}
