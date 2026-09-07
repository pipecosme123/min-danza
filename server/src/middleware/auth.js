// Verifica el JWT del header Authorization.
//
// - `requireAuth`: protege los endpoints administrativos. Acepta un token con
//   `role: "admin"` o SIN `role` (compat con los tokens de 8 h emitidos antes
//   de la Fase 9). Rechaza explícitamente un token de líder.
// - `requireLeaderAuth` (Fase 9): protege el portal de líderes
//   (`/api/leader/*`). Exige `role: "leader"` estricto y adjunta
//   `req.leader = { accountId, personId }`.
//
// Ambos usan el MISMO `JWT_SECRET`; el claim `role` es lo único que separa un
// portal del otro.

import { verifyToken } from "../services/auth.service.js";
import { UnauthorizedError } from "../utils/errors.js";

function extractBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return next(new UnauthorizedError("Falta el token de autenticación."));
  }

  try {
    const payload = verifyToken(token);
    // Un token del portal de líderes NUNCA sirve para una ruta administrativa.
    if (payload.role === "leader") {
      return next(new UnauthorizedError("Token inválido o expirado."));
    }
    req.admin = { id: payload.sub, username: payload.username };
    next();
  } catch {
    next(new UnauthorizedError("Token inválido o expirado."));
  }
}

export function requireLeaderAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return next(new UnauthorizedError("Falta el token de autenticación."));
  }

  try {
    const payload = verifyToken(token);
    if (payload.role !== "leader") {
      return next(new UnauthorizedError("Token inválido o expirado."));
    }
    req.leader = { accountId: payload.sub, personId: payload.pid };
    next();
  } catch {
    next(new UnauthorizedError("Token inválido o expirado."));
  }
}
