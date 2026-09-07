// Fase 9 · Portal de líderes. Montado en /api/leader.
//
// - POST /login            (público, leaderLoginLimiter)
// - POST /change-password  (requireLeaderAuth)
// - GET  /me               (requireLeaderAuth)
// - GET  /services              (requireLeaderAuth + gate mustChangePassword)
// - GET  /people                (idem)
// - POST /services/:slotId/:teamId/report
// - GET/PATCH/POST reports/:reportId[/submit|/reopen|/whatsapp-text]
//
// Este router SÓLO parsea/valida/serializa; la lógica vive en
// leaderAuth.service.js y attendance.service.js.
// Contrato: docs/architecture/phase9-attendance-reports-contract.md §5.1-5.2.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireLeaderAuth } from "../middleware/auth.js";
import { leaderLoginLimiter, leaderApiLimiter } from "../middleware/rateLimit.js";
import { ForbiddenError } from "../utils/errors.js";
import { leaderLogin, changeOwnPassword, getLeaderProfile } from "../services/leaderAuth.service.js";
import {
  listLeaderServices,
  searchPeopleForLeader,
  createReportDraft,
  getLeaderReport,
  saveReportDraft,
  submitReport,
  reopenReportAsLeader,
  buildWhatsappText,
} from "../services/attendance.service.js";

const router = Router();

// --------------------------------- auth ----------------------------------

const loginSchema = z.object({
  username: z.string().min(1, "username es obligatorio").max(60),
  password: z.string().min(1, "password es obligatorio").max(200),
});

router.post("/login", leaderLoginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    res.json(await leaderLogin(req.body.username, req.body.password));
  } catch (err) {
    next(err);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "La contraseña nueva debe tener al menos 8 caracteres").max(200),
});

router.post(
  "/change-password",
  leaderApiLimiter,
  requireLeaderAuth,
  validate({ body: changePasswordSchema }),
  async (req, res, next) => {
    try {
      res.json(await changeOwnPassword(req.leader.accountId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

router.get("/me", leaderApiLimiter, requireLeaderAuth, async (req, res, next) => {
  try {
    res.json(await getLeaderProfile(req.leader.accountId));
  } catch (err) {
    next(err);
  }
});

// --------------------- gate: contraseña sin cambiar ----------------------
// Todo lo que sigue exige que el líder ya haya definido su contraseña
// definitiva. `/me` y `/change-password` (arriba) quedan fuera del gate.

async function requirePasswordChanged(req, res, next) {
  try {
    const profile = await getLeaderProfile(req.leader.accountId);
    if (profile.mustChangePassword) {
      throw new ForbiddenError("Debes cambiar tu contraseña temporal antes de continuar.");
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.use(leaderApiLimiter, requireLeaderAuth, requirePasswordChanged);

// ------------------------------- servicios -------------------------------

router.get("/services", async (req, res, next) => {
  try {
    res.json(await listLeaderServices(req.leader.personId));
  } catch (err) {
    next(err);
  }
});

const peopleQuerySchema = z.object({
  query: z.string().trim().max(80).optional().default(""),
});

router.get("/people", validate({ query: peopleQuerySchema }), async (req, res, next) => {
  try {
    res.json(await searchPeopleForLeader(req.query.query));
  } catch (err) {
    next(err);
  }
});

// -------------------------------- reportes -------------------------------

const slotTeamParamsSchema = z.object({
  slotId: z.string().min(1).max(40),
  teamId: z.string().min(1).max(40),
});
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

const saveDraftSchema = z
  .object({
    entries: z.array(entrySchema).max(200).optional(),
    supports: z.array(supportSchema).max(100).optional(),
    generalNotes: z.string().trim().max(4000).nullable().optional(),
  })
  .default({});

router.post(
  "/services/:slotId/:teamId/report",
  validate({ params: slotTeamParamsSchema }),
  async (req, res, next) => {
    try {
      const result = await createReportDraft(req.leader, req.params.slotId, req.params.teamId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/reports/:reportId", validate({ params: reportIdParamSchema }), async (req, res, next) => {
  try {
    res.json(await getLeaderReport(req.leader, req.params.reportId));
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/reports/:reportId",
  validate({ params: reportIdParamSchema, body: saveDraftSchema }),
  async (req, res, next) => {
    try {
      res.json(await saveReportDraft(req.leader, req.params.reportId, req.body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/reports/:reportId/submit",
  validate({ params: reportIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await submitReport(req.leader, req.params.reportId));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/reports/:reportId/reopen",
  validate({ params: reportIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await reopenReportAsLeader(req.leader, req.params.reportId));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/reports/:reportId/whatsapp-text",
  validate({ params: reportIdParamSchema }),
  async (req, res, next) => {
    try {
      res.json(await buildWhatsappText({ leader: req.leader, reportId: req.params.reportId }));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
