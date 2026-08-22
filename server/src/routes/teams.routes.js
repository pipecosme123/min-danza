// POST /api/months/:id/generate-teams, GET /api/months/:id/teams,
// PATCH /api/teams/:teamId. Contrato cerrado:
// docs/architecture/phase3-teams-contract.md.
// Este router SOLO parsea/valida/serializa; toda la lógica de negocio vive
// en services/teamGeneration.service.js.
// Router administrativo -> protegido con requireAuth.
//
// IMPORTANTE: este router se monta en "/" (mezcla rutas bajo /months/:id/...
// y /teams/:id), así que requireAuth se aplica POR RUTA (no con
// `router.use(requireAuth)` a nivel de router) — un `router.use` sin filtro
// de path en un router montado en "/" correría como middleware global para
// CUALQUIER request de la app, incluidos los endpoints públicos. Por la
// misma razón, `adminLimiter` (ver rateLimit.js y el comentario en
// routes/index.js) también se aplica POR RUTA acá, no con `router.use`.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { adminLimiter } from "../middleware/rateLimit.js";
import { generateTeams, listTeamsForMonth, updateTeam } from "../services/teamGeneration.service.js";

const router = Router();

const monthIdParamSchema = z.object({ id: z.string().min(1).max(40) });
const teamIdParamSchema = z.object({ teamId: z.string().min(1).max(40) });

const memberSchema = z.object({
  personId: z.string().min(1).max(40),
  role: z.enum(["LEADER", "SUPPORT", "COLLABORATOR"]),
});

// El equipo de jóvenes se arma en el MISMO POST generate-teams (ver
// teamGeneration.service.js), no es un roster manual aparte.
// leaderPersonId es obligatorio solo cuando enabled: true (superRefine);
// la validación de que esa persona exista/esté activa/sea isJoven vive en
// el service (requiere ir a la base) -> 400 LIDER_JOVENES_INVALIDO ahí.
const youthTeamSchema = z
  .object({
    enabled: z.boolean(),
    size: z.coerce
      .number()
      .int("youthTeam.size debe ser un entero")
      .min(1, "youthTeam.size debe ser >= 1")
      .default(10),
    leaderPersonId: z.string().min(1).max(40).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enabled && !data.leaderPersonId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "youthTeam.leaderPersonId es obligatorio cuando youthTeam.enabled es true.",
        path: ["leaderPersonId"],
      });
    }
  });

// .default({}) porque el body es opcional en su totalidad: los llamados
// existentes a POST generate-teams sin youthTeam (ni body en absoluto, como
// en la mayoría de teamGeneration.test.js) no envían Content-Type json, así
// que req.body llega `undefined` a este schema.
//
// teamCount (agregado 2026-08-22): opcional -- si no viene, se sortea con el
// `teamCount` que el mes ya tenía (comportamiento histórico). Si viene,
// permite elegir de nuevo cuántos equipos formar al (re)sortear, sin tener
// que borrar el mes y crear uno nuevo -- mismo rango que al crear el mes.
const generateTeamsBodySchema = z
  .object({
    youthTeam: youthTeamSchema.optional(),
    teamCount: z.coerce
      .number()
      .int("teamCount debe ser un entero")
      .min(1, "teamCount debe ser >= 1")
      .max(50, "teamCount debe ser <= 50")
      .optional(),
  })
  .default({});

const patchBodySchema = z
  .object({
    members: z.array(memberSchema),
  })
  .superRefine((data, ctx) => {
    const seen = new Set();
    for (const m of data.members) {
      if (seen.has(m.personId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `personId duplicado en el body: ${m.personId}`,
          path: ["members"],
        });
        return;
      }
      seen.add(m.personId);
    }
  });

router.post(
  "/months/:id/generate-teams",
  adminLimiter,
  requireAuth,
  validate({ params: monthIdParamSchema, body: generateTeamsBodySchema }),
  async (req, res, next) => {
    try {
      const result = await generateTeams(req.params.id, {
        youthTeam: req.body.youthTeam,
        teamCount: req.body.teamCount,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/months/:id/teams", adminLimiter, requireAuth, validate({ params: monthIdParamSchema }), async (req, res, next) => {
  try {
    const result = await listTeamsForMonth(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/teams/:teamId",
  adminLimiter,
  requireAuth,
  validate({ params: teamIdParamSchema, body: patchBodySchema }),
  async (req, res, next) => {
    try {
      const result = await updateTeam(req.params.teamId, req.body.members);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
