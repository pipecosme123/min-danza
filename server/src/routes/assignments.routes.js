// PATCH /api/assignments/:id (lock/unlock, cambiar equipo de una SlotAssignment).
// Contrato cerrado: docs/architecture/phase4-schedule-contract.md §6. Este
// router SOLO parsea/valida/serializa; toda la lógica de negocio vive en
// services/assignments.service.js. Router administrativo -> protegido con
// requireAuth.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { updateAssignment } from "../services/assignments.service.js";

const router = Router();

router.use(requireAuth);

const idParamSchema = z.object({ id: z.string().min(1).max(40) });

const patchBodySchema = z
  .object({
    locked: z.boolean().optional(),
    teamId: z.string().min(1).max(40).optional(),
  })
  .refine((data) => data.locked !== undefined || data.teamId !== undefined, {
    message: "El body debe incluir al menos uno de: locked, teamId.",
  });

router.patch("/:id", validate({ params: idParamSchema, body: patchBodySchema }), async (req, res, next) => {
  try {
    const result = await updateAssignment(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
