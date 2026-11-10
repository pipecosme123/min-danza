import { useCallback, useState } from 'react';

/**
 * Persona que el visitante eligió como «soy yo» en la página pública,
 * recordada en este navegador (decisión 2026-11-09, Fase 10 §9.2): solo el
 * id de `Person`, que no cambia entre meses. Nunca sale del dispositivo.
 *
 * `localStorage` puede no existir o fallar (navegación privada, bloqueado):
 * en ese caso funciona igual durante la visita, solo que no se recuerda.
 */
export const REMEMBERED_PERSON_KEY = 'app_public_person_id';

function readStored() {
  try {
    return localStorage.getItem(REMEMBERED_PERSON_KEY) || null;
  } catch {
    return null;
  }
}

export function useRememberedPerson() {
  const [personId, setPersonId] = useState(readStored);

  const remember = useCallback((nextPersonId) => {
    setPersonId(nextPersonId || null);
    try {
      if (nextPersonId) localStorage.setItem(REMEMBERED_PERSON_KEY, nextPersonId);
      else localStorage.removeItem(REMEMBERED_PERSON_KEY);
    } catch {
      // Sin almacenamiento disponible: se mantiene solo en memoria.
    }
  }, []);

  const forget = useCallback(() => remember(null), [remember]);

  return { personId, remember, forget };
}
