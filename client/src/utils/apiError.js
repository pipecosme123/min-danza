/**
 * Traduce un `ApiError` a un mensaje en lenguaje llano y, cuando el servidor
 * lo envía, al código de dominio (`DOCUMENTO_DUPLICADO`, `MES_YA_EXISTE`,
 * `POOL_INSTRUCTOR_INSUFICIENTE`, ...). Centralizado acá para no repetir la
 * misma rama if/else en cada página que llama a la API (`PeopleManager`,
 * `TeamGenerator`, ...).
 */
import { ApiError } from '../api/client.js';

/**
 * @typedef {Object} ApiErrorInfo
 * @property {string} message Mensaje en lenguaje llano, listo para mostrar.
 * @property {string|null} code Código de dominio (`details.code`) si el servidor lo envió.
 * @property {Record<string, any>|Array|null} details `details` crudo del error, para leer campos extra (ej. `available`, `needed`, `monthCycleId`).
 */

/**
 * @param {unknown} err
 * @returns {ApiErrorInfo}
 */
export function describeApiError(err) {
  if (!(err instanceof ApiError)) {
    return { message: 'Ocurrió un problema inesperado. Intenta de nuevo.', code: null, details: null };
  }
  const { details } = err;
  if (details && !Array.isArray(details) && details.code) {
    return { message: err.message, code: details.code, details };
  }
  if (Array.isArray(details) && details.length > 0) {
    return { message: details.map((d) => d.message).join(' '), code: 'VALIDACION', details };
  }
  return { message: err.message, code: null, details: null };
}
