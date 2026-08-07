// Verifica el JWT del header Authorization y adjunta req.admin. Protege
// todos los endpoints administrativos (todo lo que no sea login ni la
// página pública de horario ya finalizada).

import { verifyToken } from "../services/auth.service.js";
import { UnauthorizedError } from "../utils/errors.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Falta el token de autenticación."));
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const payload = verifyToken(token);
    req.admin = { id: payload.sub, username: payload.username };
    next();
  } catch {
    next(new UnauthorizedError("Token inválido o expirado."));
  }
}
