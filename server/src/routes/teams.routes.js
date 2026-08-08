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
// CUALQUIER request de la app, incluidos los endpoints públicos.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { generateTeams, listTeamsForMonth, updateTeam } from "../services/teamGeneration.service.js";

const router = Router();

const monthIdParamSchema = z.object({ id: z.string().min(1).max(40) });
const teamIdParamSchema = z.object({ teamId: z.string().min(1).max(40) });

const memberSchema = z.object({
  personId: z.string().min(1).max(40),
  role: z.enum(["LEADER", "SUPPORT", "COLLABORATOR"]),
});

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

router.post("/months/:id/generate-teams", requireAuth, validate({ params: monthIdParamSchema }), async (req, res, next) => {
  try {
    const result = await generateTeams(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/months/:id/teams", requireAuth, validate({ params: monthIdParamSchema }), async (req, res, next) => {
  try {
    const result = await listTeamsForMonth(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/teams/:teamId",
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
