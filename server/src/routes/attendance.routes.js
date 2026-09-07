// Fase 9 · Vistas administrativas de los reportes de asistencia.
// Montado en "/" (mezcla /months/:id/attendance y /attendance/reports/:id),
// así que `requireAuth` + `adminLimiter` se aplican POR RUTA (mismo motivo
// que teams.routes.js / events.routes.js).
//
// El router sólo parsea/valida/serializa; la lógica vive en
// attendance.service.js. Contrato:
// docs/architecture/phase9-attendance-reports-contract.md §5.3.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { adminLimiter } from "../middleware/rateLimit.js";
import {
  listMonthAttendance,
  getReportForAdmin,
  adminEditReport,
  adminReopenReport,
  buildWhatsappText,
  searchPeopleForLeader,
} from "../services/attendance.service.js";

const router = Router();

const monthIdParamSchema = z.object({ id: z.string().min(1).max(40) });
const reportIdParamSchema = z.object({ reportId: z.string().min(1).max(40) });

const entrySchema = z.object({
  personId: z.string().min(1).max(40),
  status: z
    .enum(["ASISTIO", "NO_ASISTIO_CON_EXCUSA", "NO_ASISTIO_SIN_EXCUSA", "REMPLAZADO", "CAMBIO"])
    .nullable()
    .optional(),
  coveredByPersonId: z.string().min(1).max(40).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
const supportSchema = z.object({
  personId: z.string().min(1).max(40),
  note: z.string().trim().max(500).nullable().optional(),
});
const editSchema = z
  .object({
    entries: z.array(entrySchema).max(200).optional(),
    supports: z.array(supportSchema).max(100).optional(),
    generalNotes: z.string().trim().max(4000).nullable().optional(),
  })
  .default({});

router.get(
  "/months/:id/attendance",
  adminLimiter,
  requireAuth,
  validate({ params: monthIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await listMonthAttendance(req.params.id));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/attendance/reports/:reportId",
  adminLimiter,
  requireAuth,
  validate({ params: reportIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await getReportForAdmin(req.params.reportId));
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/attendance/reports/:reportId",
  adminLimiter,
  requireAuth,
  validate({ params: reportIdParamSchema, body: editSchema }),
  async (req, res, next) => {
    try {
      res.json(await adminEditReport(req.params.reportId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/attendance/reports/:reportId/reopen",
  adminLimiter,
  requireAuth,
  validate({ params: reportIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await adminReopenReport(req.params.reportId));
    } catch (err) {
      next(err);
    }
  }
);

// Padrón mínimo (id + nombre) para los selectores «cubrió» / «apoyo» cuando
// el admin edita un reporte. Misma data que GET /api/leader/people.
router.get("/attendance/people", adminLimiter, requireAuth, async (req, res, next) => {
  try {
    res.json(await searchPeopleForLeader(""));
  } catch (err) {
    next(err);
  }
});

router.get(
  "/attendance/reports/:reportId/whatsapp-text",
  adminLimiter,
  requireAuth,
  validate({ params: reportIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await buildWhatsappText({ reportId: req.params.reportId }));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
