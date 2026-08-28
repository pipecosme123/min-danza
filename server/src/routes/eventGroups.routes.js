// POST/GET /api/months/:id/event-groups, PATCH /api/event-groups/:groupId,
// POST /api/event-groups/:groupId/turnos, PATCH/DELETE
// /api/event-groups/turnos/:slotId, POST /api/event-groups/:groupId/cancel,
// DELETE /api/event-groups/:groupId. Eventos agrupados ("Congreso"). Este
// router SOLO parsea/valida/serializa; toda la lógica de negocio vive en
// services/eventGroups.service.js.
//
// IMPORTANTE: este router se monta en "/" (mezcla rutas bajo /months/:id/...
// y /event-groups/:id), así que requireAuth se aplica POR RUTA, no con
// `router.use(requireAuth)` a nivel de router (ver teams.routes.js para el
// detalle de por qué eso filtraría hacia endpoints públicos como /schedule).
// Por la misma razón, `adminLimiter` también se aplica POR RUTA acá.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { adminLimiter } from "../middleware/rateLimit.js";
import {
  createEventGroup,
  listEventGroups,
  updateEventGroupTitle,
  addTurno,
  updateTurno,
  deleteTurno,
  cancelEventGroup,
  deleteEventGroup,
} from "../services/eventGroups.service.js";

const router = Router();

const monthIdParamSchema = z.object({ id: z.string().min(1).max(40) });
const groupIdParamSchema = z.object({ groupId: z.string().min(1).max(40) });
const slotIdParamSchema = z.object({ slotId: z.string().min(1).max(40) });

const turnoSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date debe tener formato YYYY-MM-DD"),
  startTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "startTime debe tener formato HH:mm 24h"),
  teamIds: z.array(z.string().min(1).max(40)).min(1, "teamIds debe tener al menos un equipo"),
  uniformId: z.string().min(1).max(40).optional(),
});

// Mínimo 2 turnos a nivel de esquema (necesario, no suficiente, para las 2
// fechas distintas que exige el service -- 2 turnos podrían compartir fecha,
// eso lo valida createEventGroup con CONGRESO_MINIMO_DOS_FECHAS).
const createEventGroupBodySchema = z.object({
  title: z.string().min(1, "title es obligatorio").max(100, "title debe tener máximo 100 caracteres"),
  turnos: z.array(turnoSchema).min(2, "turnos debe tener al menos 2 elementos (2 fechas distintas como mínimo)"),
});

const addTurnoBodySchema = turnoSchema;

const updateTurnoBodySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date debe tener formato YYYY-MM-DD").optional(),
    startTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "startTime debe tener formato HH:mm 24h").optional(),
    teamIds: z.array(z.string().min(1).max(40)).min(1, "teamIds debe tener al menos un equipo").optional(),
    uniformId: z.string().min(1).max(40).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "El body no puede estar vacío." });

const updateGroupTitleBodySchema = z.object({
  title: z.string().min(1, "title es obligatorio").max(100, "title debe tener máximo 100 caracteres"),
});

router.post(
  "/months/:id/event-groups",
  adminLimiter,
  requireAuth,
  validate({ params: monthIdParamSchema, body: createEventGroupBodySchema }),
  async (req, res, next) => {
    try {
      const result = await createEventGroup(req.params.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/months/:id/event-groups",
  adminLimiter,
  requireAuth,
  validate({ params: monthIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await listEventGroups(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/event-groups/:groupId",
  adminLimiter,
  requireAuth,
  validate({ params: groupIdParamSchema, body: updateGroupTitleBodySchema }),
  async (req, res, next) => {
    try {
      const result = await updateEventGroupTitle(req.params.groupId, req.body.title);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/event-groups/:groupId/turnos",
  adminLimiter,
  requireAuth,
  validate({ params: groupIdParamSchema, body: addTurnoBodySchema }),
  async (req, res, next) => {
    try {
      const result = await addTurno(req.params.groupId, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/event-groups/turnos/:slotId",
  adminLimiter,
  requireAuth,
  validate({ params: slotIdParamSchema, body: updateTurnoBodySchema }),
  async (req, res, next) => {
    try {
      const result = await updateTurno(req.params.slotId, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/event-groups/turnos/:slotId",
  adminLimiter,
  requireAuth,
  validate({ params: slotIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await deleteTurno(req.params.slotId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/event-groups/:groupId/cancel",
  adminLimiter,
  requireAuth,
  validate({ params: groupIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await cancelEventGroup(req.params.groupId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/event-groups/:groupId",
  adminLimiter,
  requireAuth,
  validate({ params: groupIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await deleteEventGroup(req.params.groupId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
