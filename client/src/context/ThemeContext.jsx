import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const THEME_STORAGE_KEY = 'app_theme';
const ThemeContext = createContext(null);

function hasStoredPreference() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark';
  } catch {
    return false;
  }
}

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignoramos: se resuelve con la preferencia del sistema
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme);
  // Una vez que el usuario elige tema a mano (este toggle o una sesión previa
  // persistida en localStorage), dejamos de seguir cambios del sistema.
  const manualOverrideRef = useRef(hasStoredPreference());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // no bloquea el cambio de tema en la sesión actual
    }
  }, [theme]);

  // Si el usuario nunca eligió manualmente, seguimos el cambio de preferencia
  // del sistema en vivo (ej. el sistema operativo cambia a oscuro al anochecer).
  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => {
      if (manualOverrideRef.current) return;
      setTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    manualOverrideRef.current = true;
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe usarse dentro de <ThemeProvider>.');
  }
  return context;
}
