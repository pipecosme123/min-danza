import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { login as loginRequest } from '../api/auth.js';
import { TOKEN_STORAGE_KEY } from '../api/client.js';

const ADMIN_STORAGE_KEY = 'app_admin_display_name';

const AuthContext = createContext(null);

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredAdminName() {
  try {
    return localStorage.getItem(ADMIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(readStoredToken);
  const [adminName, setAdminName] = useState(readStoredAdminName);

  const persistSession = useCallback((nextToken, nextAdminName) => {
    setToken(nextToken);
    setAdminName(nextAdminName ?? null);
    try {
      if (nextToken) {
        localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
      if (nextAdminName) {
        localStorage.setItem(ADMIN_STORAGE_KEY, nextAdminName);
      } else {
        localStorage.removeItem(ADMIN_STORAGE_KEY);
      }
    } catch {
      // localStorage puede fallar en navegación privada; la sesión sigue
      // funcionando en memoria durante la pestaña actual.
    }
  }, []);

  const login = useCallback(
    async (username, password) => {
      const result = await loginRequest(username, password);
      persistSession(result.token, result.admin?.displayName || result.admin?.username || username);
      return result;
    },
    [persistSession],
  );

  const logout = useCallback(() => {
    persistSession(null, null);
  }, [persistSession]);

  // El cliente API dispara este evento ante un 401: la sesión ya no es
  // válida en el servidor, así que la cerramos también en el cliente.
  useEffect(() => {
    const handleUnauthorized = () => persistSession(null, null);
    window.addEventListener('app:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('app:unauthorized', handleUnauthorized);
  }, [persistSession]);

  const value = useMemo(
    () => ({
      token,
      adminName,
      isAuthenticated: Boolean(token),
      login,
      logout,
    }),
    [token, adminName, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return context;
}
