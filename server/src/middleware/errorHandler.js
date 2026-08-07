// Último middleware de la cadena. Mapea cualquier error a JSON sin filtrar
// stack traces, queries SQL ni detalles internos de Prisma al cliente — el
// detalle completo solo se loguea en el servidor.

import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Log completo solo en el servidor. Nunca se envía al cliente.
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // Errores conocidos de Prisma (P2002 unique constraint, etc.) llegan como
  // PrismaClientKnownRequestError; se traducen a un mensaje genérico 409/400
  // sin exponer el nombre de la constraint ni el SQL.
  if (err && typeof err.code === "string" && err.code.startsWith("P")) {
    const status = err.code === "P2025" ? 404 : 409;
    return res.status(status).json({
      error: { message: "La operación no pudo completarse por un conflicto con los datos existentes." },
    });
  }

  // Cualquier otro error: 500 genérico, sin stack trace ni mensaje interno.
  const status = 500;
  const message =
    env.NODE_ENV === "development" && err instanceof Error
      ? err.message
      : "Error interno del servidor.";
  return res.status(status).json({ error: { message } });
}
