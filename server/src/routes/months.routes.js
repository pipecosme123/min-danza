// GET /api/months, POST /api/months, GET /api/months/:id,
// POST /api/months/:id/finalize — ciclo mensual. Contrato cerrado:
// docs/architecture/phase3-teams-contract.md (creación/consulta) y
// docs/architecture/phase5-public-page-contract.md §1 (finalize).
// Este router SOLO parsea/valida/serializa; toda la lógica de negocio vive
// en services/teamGeneration.service.js.
// Router administrativo -> protegido con requireAuth.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import {
  listMonthCycles,
  createMonthCycle,
  getMonthCycle,
  finalizeMonthCycle,
  deleteMonthCycle,
} from "../services/teamGeneration.service.js";
import { generateSchedule, getMonthSchedule } from "../services/scheduleGeneration.service.js";

const router = Router();

router.use(requireAuth);

const generateScheduleBodySchema = z
  .object({
    regenerate: z.boolean().optional(),
  })
  // .default({}) porque el body es opcional en su totalidad, mismo patrón
  // que generateTeamsBodySchema en teams.routes.js.
  .default({});

const createBodySchema = z.object({
  year: z.coerce.number().int("year debe ser un entero").min(2000, "year debe ser >= 2000").max(2100, "year debe ser <= 2100"),
  month: z.coerce.number().int("month debe ser un entero").min(1, "month debe ser >= 1").max(12, "month debe ser <= 12"),
  teamCount: z.coerce
    .number()
    .int("teamCount debe ser un entero")
    .min(1, "teamCount debe ser >= 1")
    .max(50, "teamCount debe ser <= 50"),
});

const idParamSchema = z.object({ id: z.string().min(1).max(40) });

router.get("/", async (req, res, next) => {
  try {
    const result = await listMonthCycles();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", validate({ body: createBodySchema }), async (req, res, next) => {
  try {
    const month = await createMonthCycle(req.body);
    res.status(201).json(month);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const month = await getMonthCycle(req.params.id);
    res.json(month);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/generate-schedule",
  validate({ params: idParamSchema, body: generateScheduleBodySchema }),
  async (req, res, next) => {
    try {
      const result = await generateSchedule(req.params.id, { regenerate: req.body.regenerate ?? false });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:id/schedule", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const result = await getMonthSchedule(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/finalize", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const month = await finalizeMonthCycle(req.params.id);
    res.json(month);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", validate({ params: idParamSchema }), async (req, res, next) => {
  try {
    const result = await deleteMonthCycle(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
