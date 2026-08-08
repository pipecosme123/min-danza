// CRUD de Person + POST /api/people/import (carga masiva CSV/Excel).
// Contrato cerrado: docs/architecture/phase2-people-contract.md.
// Este router SOLO parsea/valida/serializa; toda la lógica de negocio vive
// en services/people.service.js y services/importPeople.service.js.

import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError, ValidationError } from "../utils/errors.js";
import { normalizeName, normalizeDocument } from "../utils/normalize.js";
import { listPeople, createPerson, updatePerson, deletePerson } from "../services/people.service.js";
import { importPeopleFromFile } from "../services/importPeople.service.js";

const router = Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Esquemas zod — sección 5 del contrato. Las mismas reglas (regex, límites
// de longitud) se replican a mano en importPeople.service.js para validar
// cada fila del import; ambos caminos comparten normalizeName/normalizeDocument
// (P8) para que un dato válido por uno lo sea por el otro.
// ---------------------------------------------------------------------------

const fullNameSchema = z
  .string()
  .transform((s) => normalizeName(s))
  .pipe(
    z
      .string()
      .min(3, "El nombre debe tener al menos 3 caracteres")
      .max(120, "El nombre no puede superar 120 caracteres")
      .regex(/^\p{L}[\p{L}\p{M}\s'.-]*$/u, "El nombre solo admite letras, espacios, apóstrofos, guiones y puntos")
  );

const documentIdRequiredSchema = z
  .string()
  .transform((s) => normalizeDocument(s))
  .pipe(
    z
      .string()
      .min(3, "El documento debe tener al menos 3 caracteres")
      .max(30, "El documento no puede superar 30 caracteres")
      .regex(/^[A-Z0-9]+$/, "El documento solo admite letras y números")
  );

// documentId es .nullish() en POST/PATCH: "" y null se guardan como null (no
// se valida contra el índice único con un string vacío). Un valor no vacío
// SÍ pasa por las reglas completas de documentIdRequiredSchema.
const documentIdOptionalSchema = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === "") return null;
    const result = documentIdRequiredSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message });
      }
      return z.NEVER;
    }
    return result.data;
  });

const categorySchema = z.enum(["ELEGIBLE_LIDER", "COLABORADOR"]);
const notesSchema = z.string().trim().max(500, "Las notas no pueden superar 500 caracteres").nullish();
const idParamSchema = z.object({ id: z.string().min(1).max(40) });

const listQuerySchema = z.object({
  page: z.coerce.number().int("page debe ser un entero").min(1, "page debe ser >= 1").default(1),
  pageSize: z.coerce
    .number()
    .int("pageSize debe ser un entero")
    .min(1, "pageSize debe ser >= 1")
    .max(100, "pageSize no puede superar 100")
    .default(25),
  search: z.string().trim().min(1).max(100).optional(),
  category: categorySchema.optional(),
  active: z
    .enum(["true", "false"], { message: "active debe ser 'true' o 'false'" })
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  sort: z.enum(["fullName", "-fullName", "createdAt", "-createdAt"]).default("fullName"),
});

const createBodySchema = z.object({
  fullName: fullNameSchema,
  documentId: documentIdOptionalSchema,
  category: categorySchema,
  notes: notesSchema,
  confirmDuplicateName: z.boolean().optional().default(false),
});

const patchBodySchema = z.object({
  fullName: fullNameSchema.optional(),
  documentId: documentIdOptionalSchema,
  category: categorySchema.optional(),
  notes: notesSchema,
  active: z.boolean().optional(),
});

const deleteQuerySchema = z.object({
  purge: z
    .enum(["true", "false"], { message: "purge debe ser 'true' o 'false'" })
    .optional()
    .transform((v) => v === "true"),
});

// ---------------------------------------------------------------------------
// P20 — multer en memoria, límites duros, fileFilter por extensión y
// mimetype. MulterError no lo reconoce errorHandler.js: se traduce a mano.
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);
const ALLOWED_MIMETYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase();
    if (ext === ".xls") {
      return cb(
        new ValidationError("El formato .xls no es compatible. Guarda el archivo como .xlsx o .csv.", {
          code: "FORMATO_NO_SOPORTADO",
        })
      );
    }
    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(
        new ValidationError("Formato de archivo no soportado. Usa .csv o .xlsx.", {
          code: "FORMATO_NO_SOPORTADO",
        })
      );
    }
    cb(null, true);
  },
});

function uploadSingleFile(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new HttpError(413, "El archivo supera el tamaño máximo permitido (2 MB).", {
            code: "ARCHIVO_MUY_GRANDE",
          })
        );
      }
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return next(
          new ValidationError("Se espera un único archivo en el campo 'file'.", { code: "ARCHIVO_INVALIDO" })
        );
      }
      return next(new ValidationError("No se pudo procesar el archivo subido.", { code: "ARCHIVO_INVALIDO" }));
    }

    // fileFilter ya lanza ValidationError (AppError), errorHandler.js la reconoce tal cual.
    return next(err);
  });
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

router.get("/", validate({ query: listQuerySchema }), async (req, res, next) => {
  try {
    const result = await listPeople(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/", validate({ body: createBodySchema }), async (req, res, next) => {
  try {
    const person = await createPerson(req.body);
    res.status(201).json(person);
  } catch (err) {
    next(err);
  }
});

router.post("/import", uploadSingleFile, async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ValidationError("No se recibió ningún archivo. Usa el campo 'file'.", { code: "ARCHIVO_VACIO" });
    }
    const report = await importPeopleFromFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
    });
    res.status(200).json(report);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", validate({ params: idParamSchema, body: patchBodySchema }), async (req, res, next) => {
  try {
    const patch = req.body;
    const hasAnyChange = Object.values(patch).some((v) => v !== undefined);
    if (!hasAnyChange) {
      throw new ValidationError("El cuerpo debe incluir al menos un campo para actualizar.", {
        code: "SIN_CAMBIOS",
      });
    }
    const result = await updatePerson(req.params.id, patch);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", validate({ params: idParamSchema, query: deleteQuerySchema }), async (req, res, next) => {
  try {
    const result = await deletePerson(req.params.id, { purge: req.query.purge });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
