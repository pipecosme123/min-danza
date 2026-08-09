// Reglas compartidas sobre qué se puede editar de un MonthCycle según su
// status y, para las tres acciones puntuales habilitadas tras publicar
// (agregar/cancelar/eliminar evento extraordinario, cambiar el uniforme de
// un turno), según si el mes ya pasó. Contrato cerrado:
// docs/architecture/phase4c-post-publish-edits-contract.md §0 y §3.
//
// Usado por events.service.js (createEvent, deleteEvent, cancelEvent) y
// slots.service.js (updateSlotUniform). NO lo uses en updateEvent (edición
// completa) ni en ninguna otra acción de la tabla §0 que sigue bloqueada sin
// excepción de fecha — esas siguen con el `assertDraft` de siempre.

import { ConflictError } from "./errors.js";
import { currentCivilDate } from "./dates.js";
import { env } from "../config/env.js";

/**
 * @param {{ status: "DRAFT" | "FINALIZED", year: number, month: number }} month
 */
export function assertEditableConsideringFinalization(month) {
  if (month.status === "DRAFT") return;

  const today = currentCivilDate(env.APP_TIMEZONE);
  const isPast = month.year < today.year || (month.year === today.year && month.month < today.month);
  if (isPast) {
    throw new ConflictError("Este mes ya pasó y no admite cambios.", { code: "MES_PASADO" });
  }
  // FINALIZED pero mes actual o futuro: permitido, sigue.
}
