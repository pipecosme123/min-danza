// Valida body/query/params contra un esquema zod ANTES de que el handler de
// ruta o cualquier service toque la base de datos. Nunca confiar en el
// tipado de TS/JS en runtime — todo input externo se valida aquí.

import { ValidationError } from "../utils/errors.js";

/**
 * @param {{ body?: import("zod").ZodType, query?: import("zod").ZodType, params?: import("zod").ZodType }} schemas
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.params) {
        req.params = parseOrThrow(schemas.params, req.params, "params");
      }
      if (schemas.query) {
        req.query = parseOrThrow(schemas.query, req.query, "query");
      }
      if (schemas.body) {
        req.body = parseOrThrow(schemas.body, req.body, "body");
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function parseOrThrow(schema, data, label) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: `${label}.${issue.path.join(".")}`,
      message: issue.message,
    }));
    throw new ValidationError(`Datos inválidos en ${label}`, details);
  }
  return result.data;
}
