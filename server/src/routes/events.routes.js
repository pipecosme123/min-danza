// POST/DELETE /api/months/:id/events (eventos extraordinarios). Contrato
// cerrado: docs/architecture/phase4-schedule-contract.md §4-5. Este router
// SOLO parsea/valida/serializa; toda la lógica de negocio vive en
// services/events.service.js. Router administrativo -> protegido con
// requireAuth.
//
// IMPORTANTE: este router se monta en "/" (mezcla rutas bajo /months/:id/...
// y /events/:id), así que requireAuth se aplica POR RUTA, no con
// `router.use(requireAuth)` a nivel de router (ver teams.routes.js para el
// detalle de por qué eso filtraría hacia endpoints públicos como /schedule).

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { createEvent, deleteEvent } from "../services/events.service.js";

const router = Router();

const monthIdParamSchema = z.object({ id: z.string().min(1).max(40) });
const eventIdParamSchema = z.object({ eventId: z.string().min(1).max(40) });

const createEventBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date debe tener formato YYYY-MM-DD"),
  startTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "startTime debe tener formato HH:mm 24h"),
  title: z.string().min(1, "title es obligatorio").max(100, "title debe tener máximo 100 caracteres"),
  teamsNeeded: z.coerce
    .number()
    .int("teamsNeeded debe ser un entero")
    .refine((v) => v === 1 || v === 2, "teamsNeeded debe ser 1 o 2"),
  uniformId: z.string().min(1).max(40).optional(),
});

router.post(
  "/months/:id/events",
  requireAuth,
  validate({ params: monthIdParamSchema, body: createEventBodySchema }),
  async (req, res, next) => {
    try {
      const result = await createEvent(req.params.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/events/:eventId",
  requireAuth,
  validate({ params: eventIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await deleteEvent(req.params.eventId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
