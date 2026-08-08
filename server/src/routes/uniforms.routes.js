// CRUD de Uniform + configuración de WeekdayUniform / YouthServiceUniform.
// Contrato cerrado: docs/architecture/phase4-schedule-contract.md §7. Este
// router SOLO parsea/valida/serializa; toda la lógica de negocio vive en
// services/uniforms.service.js. Router administrativo -> protegido con
// requireAuth.
//
// Orden de rutas importante: las rutas estáticas de un solo segmento
// (/weekday-config, /youth-service-config) deben declararse ANTES de
// PATCH "/:id" — si no, Express matchearía "/youth-service-config" como si
// fuera un :id y llamaría a updateUniform por error.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import {
  listUniforms,
  createUniform,
  updateUniform,
  listWeekdayUniforms,
  updateWeekdayUniform,
  getYouthServiceUniform,
  updateYouthServiceUniform,
} from "../services/uniforms.service.js";

const router = Router();

router.use(requireAuth);

const idParamSchema = z.object({ id: z.string().min(1).max(40) });
const weekdayParamSchema = z.object({ weekday: z.enum(["WEDNESDAY", "SUNDAY"]) });

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

const weekdayConfigBodySchema = z.object({ uniformId: z.string().min(1).max(40) });
const youthServiceConfigBodySchema = z.object({ uniformId: z.string().min(1).max(40) });

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

router.get("/weekday-config", async (req, res, next) => {
  try {
    res.json(await listWeekdayUniforms());
  } catch (err) {
    next(err);
  }
});

// Verbo real PATCH (no PUT) a propósito: el frontend ya existente llama con
// apiClient.patch — ver docs/architecture/phase4-schedule-contract.md §7.
router.patch(
  "/weekday-config/:weekday",
  validate({ params: weekdayParamSchema, body: weekdayConfigBodySchema }),
  async (req, res, next) => {
    try {
      const row = await updateWeekdayUniform(req.params.weekday, req.body.uniformId);
      res.json(row);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/youth-service-config", async (req, res, next) => {
  try {
    res.json(await getYouthServiceUniform());
  } catch (err) {
    next(err);
  }
});

router.patch("/youth-service-config", validate({ body: youthServiceConfigBodySchema }), async (req, res, next) => {
  try {
    const row = await updateYouthServiceUniform(req.body.uniformId);
    res.json(row);
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
