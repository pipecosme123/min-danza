// GET /api/schedule/latest y GET /api/schedule/:year/:month — únicos
// endpoints de lectura PÚBLICOS (sin auth) de la app: la organización del
// mes FINALIZED más reciente. Contrato cerrado:
// docs/architecture/phase5-public-page-contract.md §3. Un mes DRAFT nunca se
// expone -- ver publicSchedule.service.js (mismo 404 genérico para "no
// existe" y "existe pero DRAFT", a propósito).
// Este router SOLO parsea/valida/serializa; toda la lógica vive en
// services/publicSchedule.service.js. Cacheado (lib/cache.js) ahí mismo.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { publicLimiter } from "../middleware/rateLimit.js";
import { getPublicScheduleFor, getLatestPublicSchedule } from "../services/publicSchedule.service.js";

const router = Router();

router.use(publicLimiter);

// Mismas reglas de rango que createBodySchema en months.routes.js.
const yearMonthParamSchema = z.object({
  year: z.coerce.number().int("year debe ser un entero").min(2000, "year debe ser >= 2000").max(2100, "year debe ser <= 2100"),
  month: z.coerce.number().int("month debe ser un entero").min(1, "month debe ser >= 1").max(12, "month debe ser <= 12"),
});

router.get("/latest", async (req, res, next) => {
  try {
    const payload = await getLatestPublicSchedule();
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get("/:year/:month", validate({ params: yearMonthParamSchema }), async (req, res, next) => {
  try {
    const payload = await getPublicScheduleFor(req.params.year, req.params.month);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
