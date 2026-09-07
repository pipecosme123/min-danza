/**
 * Cliente HTTP único de la aplicación.
 *
 * Toda llamada a la API pasa por aquí. Ningún componente ni página debe usar
 * `fetch` directamente: los archivos `api/<recurso>.js` exponen funciones de
 * negocio (getPeople, importPeople, ...) que usan este cliente por debajo.
 * Esto es lo que permite que la UI dependa de una abstracción (D en SOLID)
 * y no de detalles concretos de transporte.
 */

/** Clave de localStorage donde AuthContext persiste el token JWT del admin. */
export const TOKEN_STORAGE_KEY = 'app_auth_token';
/**
 * Clave separada para el token del portal de líderes (Fase 9). Vive aparte
 * del token de admin a propósito: los dos portales pueden estar abiertos en
 * el mismo navegador sin pisarse, y cerrar sesión en uno no afecta al otro.
 */
export const LEADER_TOKEN_STORAGE_KEY = 'app_leader_token';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(message, { status = 0, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function getToken(audience) {
  try {
    const key = audience === 'leader' ? LEADER_TOKEN_STORAGE_KEY : TOKEN_STORAGE_KEY;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Notifica al contexto de auth correspondiente que el token dejó de ser
 * válido (401) para que cierre sesión de inmediato, sin que este módulo
 * dependa de React. El portal de líderes escucha `app:unauthorized:leader`
 * para no desloguear al admin (y viceversa).
 */
function notifyUnauthorized(audience) {
  window.dispatchEvent(new Event(audience === 'leader' ? 'app:unauthorized:leader' : 'app:unauthorized'));
}

async function request(path, { method = 'GET', body, headers, signal, auth = 'admin' } = {}) {
  const isFormData = body instanceof FormData;
  const token = getToken(auth);

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body == null ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.', {
      status: 0,
    });
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized(auth);
    throw new ApiError(
      payload?.error?.message ?? payload?.message ?? `Error ${response.status} al comunicarse con el servidor.`,
      {
        status: response.status,
        details: payload?.error?.details ?? null,
      },
    );
  }

  return payload;
}

export const apiClient = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
