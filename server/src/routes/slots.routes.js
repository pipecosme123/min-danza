// PATCH /api/slots/:id — vía genérica de "elegí el uniforme de este turno",
// funciona para cualquier slotType (FIXED, YOUTH_SERVICE, EXTRAORDINARY).
// Contrato cerrado: docs/architecture/phase4b-schedule-refinements-contract.md
// §1.3. Este router SOLO parsea/valida/serializa; toda la lógica de negocio
// vive en services/slots.service.js. Router administrativo -> protegido con
// requireAuth. Mismo estilo que assignments.routes.js.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { updateSlotUniform } from "../services/slots.service.js";

const router = Router();

router.use(requireAuth);

const idParamSchema = z.object({ id: z.string().min(1).max(40) });

const patchBodySchema = z.object({
  uniformId: z.string().min(1).max(40).nullable(),
});

router.patch("/:id", validate({ params: idParamSchema, body: patchBodySchema }), async (req, res, next) => {
  try {
    const result = await updateSlotUniform(req.params.id, req.body.uniformId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
