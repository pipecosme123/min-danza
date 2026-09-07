import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { leaderLogin as leaderLoginRequest } from '../api/leader.js';
import { LEADER_TOKEN_STORAGE_KEY } from '../api/client.js';

/**
 * Sesión del portal de líderes (Fase 9). Vive completamente aparte de
 * `AuthContext` (el del admin): token propio, evento de 401 propio
 * (`app:unauthorized:leader`). Un navegador puede tener las dos sesiones
 * abiertas sin que una pise a la otra.
 */
const LEADER_NAME_KEY = 'app_leader_name';
const MUST_CHANGE_KEY = 'app_leader_must_change';

const LeaderAuthContext = createContext(null);

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function LeaderAuthProvider({ children }) {
  const [token, setToken] = useState(() => readStored(LEADER_TOKEN_STORAGE_KEY));
  const [leaderName, setLeaderName] = useState(() => readStored(LEADER_NAME_KEY));
  const [mustChangePassword, setMustChangePassword] = useState(
    () => readStored(MUST_CHANGE_KEY) === 'true',
  );

  const persist = useCallback((nextToken, nextName, nextMustChange) => {
    setToken(nextToken);
    setLeaderName(nextName ?? null);
    setMustChangePassword(Boolean(nextMustChange));
    try {
      if (nextToken) {
        localStorage.setItem(LEADER_TOKEN_STORAGE_KEY, nextToken);
        localStorage.setItem(MUST_CHANGE_KEY, nextMustChange ? 'true' : 'false');
      } else {
        localStorage.removeItem(LEADER_TOKEN_STORAGE_KEY);
        localStorage.removeItem(MUST_CHANGE_KEY);
      }
      if (nextName) localStorage.setItem(LEADER_NAME_KEY, nextName);
      else localStorage.removeItem(LEADER_NAME_KEY);
    } catch {
      // localStorage puede fallar en navegación privada; la sesión sigue en memoria.
    }
  }, []);

  const login = useCallback(
    async (username, password) => {
      const result = await leaderLoginRequest(username, password);
      persist(result.token, result.leader?.fullName || username, result.mustChangePassword);
      return result;
    },
    [persist],
  );

  const logout = useCallback(() => persist(null, null, false), [persist]);

  /** Lo llama la pantalla de cambio de contraseña forzado al terminar. */
  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    try {
      localStorage.setItem(MUST_CHANGE_KEY, 'false');
    } catch {
      /* ver persist */
    }
  }, []);

  useEffect(() => {
    const handle = () => persist(null, null, false);
    window.addEventListener('app:unauthorized:leader', handle);
    return () => window.removeEventListener('app:unauthorized:leader', handle);
  }, [persist]);

  const value = useMemo(
    () => ({
      token,
      leaderName,
      mustChangePassword,
      isAuthenticated: Boolean(token),
      login,
      logout,
      clearMustChangePassword,
    }),
    [token, leaderName, mustChangePassword, login, logout, clearMustChangePassword],
  );

  return <LeaderAuthContext.Provider value={value}>{children}</LeaderAuthContext.Provider>;
}

export function useLeaderAuth() {
  const context = useContext(LeaderAuthContext);
  if (!context) {
    throw new Error('useLeaderAuth debe usarse dentro de <LeaderAuthProvider>.');
  }
  return context;
}
