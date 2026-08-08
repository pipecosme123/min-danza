// CRUD de Uniform. Contrato cerrado: docs/architecture/phase4-schedule-contract.md
// §7, recortado por docs/architecture/phase4b-schedule-refinements-contract.md
// §1.4 (se eliminaron los endpoints de configuración automática por día de
// semana / Servicio de jóvenes — ya no hay "configuración", solo CRUD puro).
// Este router SOLO parsea/valida/serializa; toda la lógica de negocio vive
// en services/uniforms.service.js. Router administrativo -> protegido con
// requireAuth.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { listUniforms, createUniform, updateUniform } from "../services/uniforms.service.js";

const router = Router();

router.use(requireAuth);

const idParamSchema = z.object({ id: z.string().min(1).max(40) });

const createUniformBodySchema = z.object({
  name: z.string().min(1, "name es obligatorio").max(100),
  colorHex: z.string().max(20).optional(),
  description: z.string().max(500).optional(),
});

const patchUniformBodySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    colorHex: z.string().max(20).optional(),
    description: z.string().max(500).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "El body no puede estar vacío." });

router.get("/", async (req, res, next) => {
  try {
    res.json(await listUniforms());
  } catch (err) {
    next(err);
  }
});

router.post("/", validate({ body: createUniformBodySchema }), async (req, res, next) => {
  try {
    const uniform = await createUniform(req.body);
    res.status(201).json(uniform);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", validate({ params: idParamSchema, body: patchUniformBodySchema }), async (req, res, next) => {
  try {
    const uniform = await updateUniform(req.params.id, req.body);
    res.json(uniform);
  } catch (err) {
    next(err);
  }
});

export default router;
