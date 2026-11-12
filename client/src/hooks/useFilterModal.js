import { useState } from 'react';

/**
 * Estado de un conjunto de filtros editados en un modal y aplicados todos
 * juntos (botón «Filtrar»), en vez de reaccionar a cada cambio de campo.
 *
 * - `applied`: los filtros vigentes (lo que consume la tabla/la API). Solo
 *   cambia de referencia al aplicar, quitar un chip o limpiar, así un
 *   `useEffect([applied])` dispara exactamente una consulta por acción.
 * - `draft`: la copia que se edita dentro del modal; se descarta si se
 *   cierra sin filtrar.
 * - `neutral`: el valor «sin filtro» de cada clave — al quitar un chip esa
 *   clave vuelve a su valor neutral.
 *
 * @template {Record<string, string>} T
 * @param {T} initial filtros aplicados al cargar la pantalla
 * @param {T} neutral valor «sin filtro» de cada clave
 */
export function useFilterModal(initial, neutral) {
  const [applied, setApplied] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);

  function openModal() {
    setDraft(applied);
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  function setDraftField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /** «Limpiar» dentro del modal: vacía el borrador, no aplica nada todavía. */
  function clearDraft() {
    setDraft(neutral);
  }

  /** «Filtrar»: aplica todos los filtros del borrador al mismo tiempo. */
  function apply() {
    setApplied(draft);
    setOpen(false);
  }

  /** Quitar un chip: devuelve esa clave a su valor neutral y aplica. */
  function removeFilter(key) {
    setApplied((current) => ({ ...current, [key]: neutral[key] }));
  }

  /** «Quitar todos»: aplica el estado neutral completo. */
  function clearAll() {
    setApplied(neutral);
  }

  /** Claves cuyo valor aplicado restringe algo (distinto del neutral). */
  const activeKeys = Object.keys(neutral).filter((key) => applied[key] !== neutral[key]);

  return {
    applied,
    draft,
    open,
    activeKeys,
    openModal,
    closeModal,
    setDraftField,
    clearDraft,
    apply,
    removeFilter,
    clearAll,
  };
}
