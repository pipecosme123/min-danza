// GET/POST /api/months/:id/verses, PATCH/DELETE /api/verses/:verseId.
// "Versículo del mes" (Parte 4, wise-noodling-hickey.md). Este router SOLO
// parsea/valida/serializa; toda la lógica de negocio vive en
// services/verses.service.js.
//
// IMPORTANTE: este router se monta en "/" (mezcla rutas bajo /months/:id/...
// y /verses/:id), así que requireAuth se aplica POR RUTA, no con
// `router.use(requireAuth)` a nivel de router (ver teams.routes.js para el
// detalle de por qué eso filtraría hacia endpoints públicos como /schedule).
// Por la misma razón, `adminLimiter` también se aplica POR RUTA acá.

import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { adminLimiter } from "../middleware/rateLimit.js";
import { listVerses, addVerse, updateVerse, deleteVerse } from "../services/verses.service.js";

const router = Router();

const monthIdParamSchema = z.object({ id: z.string().min(1).max(40) });
const verseIdParamSchema = z.object({ verseId: z.string().min(1).max(40) });

// "16", "16-18" o "16,18,20" -- rango tal como lo escribe el admin.
const VERSES_REGEX = /^\d{1,3}(-\d{1,3})?(,\d{1,3}(-\d{1,3})?)*$/;

const addVerseBodySchema = z.object({
  book: z.string().min(1, "book es obligatorio").max(50, "book debe tener máximo 50 caracteres"),
  chapter: z.coerce.number().int("chapter debe ser un entero").min(1, "chapter debe ser >= 1"),
  verses: z.string().regex(VERSES_REGEX, 'verses debe tener el formato "16", "16-18" o "16,18,20"'),
});

const updateVerseBodySchema = z
  .object({
    book: z.string().min(1, "book es obligatorio").max(50, "book debe tener máximo 50 caracteres").optional(),
    chapter: z.coerce.number().int("chapter debe ser un entero").min(1, "chapter debe ser >= 1").optional(),
    verses: z.string().regex(VERSES_REGEX, 'verses debe tener el formato "16", "16-18" o "16,18,20"').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "El body no puede estar vacío." });

router.get(
  "/months/:id/verses",
  adminLimiter,
  requireAuth,
  validate({ params: monthIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await listVerses(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/months/:id/verses",
  adminLimiter,
  requireAuth,
  validate({ params: monthIdParamSchema, body: addVerseBodySchema }),
  async (req, res, next) => {
    try {
      const result = await addVerse(req.params.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/verses/:verseId",
  adminLimiter,
  requireAuth,
  validate({ params: verseIdParamSchema, body: updateVerseBodySchema }),
  async (req, res, next) => {
    try {
      const result = await updateVerse(req.params.verseId, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/verses/:verseId",
  adminLimiter,
  requireAuth,
  validate({ params: verseIdParamSchema }),
  async (req, res, next) => {
    try {
      const result = await deleteVerse(req.params.verseId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
