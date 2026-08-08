/**
 * Cliente HTTP único de la aplicación.
 *
 * Toda llamada a la API pasa por aquí. Ningún componente ni página debe usar
 * `fetch` directamente: los archivos `api/<recurso>.js` exponen funciones de
 * negocio (getPeople, importPeople, ...) que usan este cliente por debajo.
 * Esto es lo que permite que la UI dependa de una abstracción (D en SOLID)
 * y no de detalles concretos de transporte.
 */

/** Clave de localStorage donde AuthContext persiste el token JWT. */
export const TOKEN_STORAGE_KEY = 'app_auth_token';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(message, { status = 0, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Notifica a AuthContext que el token dejó de ser válido (401) para que
 * pueda cerrar sesión de inmediato, sin que este módulo dependa de React.
 */
function notifyUnauthorized() {
  window.dispatchEvent(new Event('app:unauthorized'));
}

async function request(path, { method = 'GET', body, headers, signal } = {}) {
  const isFormData = body instanceof FormData;
  const token = getToken();

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
    if (response.status === 401) notifyUnauthorized();
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
