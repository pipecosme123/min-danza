// Lógica de autenticación del único AdminUser. routes/auth.routes.js solo
// parsea/serializa; toda la verificación de credenciales y emisión de JWT
// vive aquí.

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { UnauthorizedError } from "../utils/errors.js";

const TOKEN_TTL = "8h";

/**
 * Verifica username/password contra el AdminUser sembrado y devuelve un JWT.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ token: string, admin: { id: string, username: string, displayName: string | null } }>}
 */
export async function login(username, password) {
  const admin = await prisma.adminUser.findUnique({ where: { username } });

  // Mismo mensaje genérico tanto si el usuario no existe como si la
  // contraseña es incorrecta: no revelar cuál de las dos falló.
  if (!admin || !admin.active) {
    throw new UnauthorizedError("Usuario o contraseña incorrectos.");
  }

  const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError("Usuario o contraseña incorrectos.");
  }

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  // `role: "admin"` (Fase 9): distingue este token del token del portal de
  // líderes, firmado con el MISMO JWT_SECRET. `requireAuth` acepta también un
  // token sin `role` (compat con los de 8 h ya emitidos antes de la Fase 9);
  // `requireLeaderAuth` en cambio exige `role: "leader"` estricto.
  const token = jwt.sign({ sub: admin.id, username: admin.username, role: "admin" }, env.JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });

  return {
    token,
    admin: { id: admin.id, username: admin.username, displayName: admin.displayName },
  };
}

/**
 * Verifica un JWT y devuelve su payload. Lanza si es inválido/expirado.
 * @param {string} token
 */
export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}
