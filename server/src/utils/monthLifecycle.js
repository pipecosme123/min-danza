// Reglas compartidas sobre qué se puede editar de un MonthCycle según su
// status y, para las acciones habilitadas tras publicar, según si el mes ya
// pasó: DRAFT sin restricción, FINALIZED solo si (year, month) es el mes
// actual o uno futuro (409 MES_PASADO si no). Contrato cerrado:
// docs/architecture/phase4c-post-publish-edits-contract.md §0 y §3.
//
// Usado por events.service.js (createEvent, deleteEvent, cancelEvent,
// updateEvent -- este último ampliado 2026-08-25, antes exigía DRAFT sin
// excepción), slots.service.js (updateSlotUniform), assignments.service.js
// (updateAssignment, ampliado 2026-08-25), teamGeneration.service.js
// (deleteMonthCycle, agregado 2026-08-22; updateTeam, ampliado 2026-08-25) y
// youthTeam.service.js (cancelYouthService/deleteYouthTeam, agregado
// 2026-08-25). Ya no queda ninguna acción de escritura administrativa que
// use el `assertDraft` incondicional salvo generate-teams/generate-schedule
// (re-sortear/regenerar borra todo el mes, no tiene sentido permitirlo
// publicado).

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
