// Fase 9 · Autenticación del portal de líderes. El router
// (routes/leader.routes.js) sólo parsea/valida/serializa; toda la
// verificación de credenciales y emisión de JWT vive aquí.
//
// Contrato: docs/architecture/phase9-attendance-reports-contract.md §5.1-5.2.
// El alta de cuentas y su gestión administrativa viven en
// leaderAccounts.service.js.

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { UnauthorizedError, ValidationError, ConflictError } from "../utils/errors.js";

const TOKEN_TTL = "12h";
const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Verifica username/password contra una LeaderAccount activa y devuelve un JWT
 * con `role: "leader"`. Mismo mensaje genérico tanto si la cuenta no existe,
 * como si está inactiva, como si la contraseña es incorrecta.
 * @param {string} username
 * @param {string} password
 */
export async function leaderLogin(username, password) {
  const account = await prisma.leaderAccount.findUnique({
    where: { username },
    include: { person: { select: { fullName: true } } },
  });

  const genericError = new UnauthorizedError("Usuario o contraseña incorrectos.");
  if (!account || !account.active) throw genericError;

  const matches = await bcrypt.compare(password, account.passwordHash);
  if (!matches) throw genericError;

  await prisma.leaderAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
  });

  const token = jwt.sign(
    { sub: account.id, pid: account.personId, role: "leader" },
    env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

  return {
    token,
    leader: { id: account.id, fullName: account.person.fullName },
    mustChangePassword: account.mustChangePassword,
  };
}

/**
 * Cambio de contraseña del propio líder. Único endpoint permitido mientras
 * `mustChangePassword` sea true. Exige la contraseña actual (incluida la
 * temporal del alta).
 * @param {string} accountId
 * @param {{ currentPassword: string, newPassword: string }} data
 */
export async function changeOwnPassword(accountId, { currentPassword, newPassword }) {
  const account = await prisma.leaderAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.active) {
    throw new UnauthorizedError("La cuenta ya no está disponible.");
  }

  const matches = await bcrypt.compare(currentPassword, account.passwordHash);
  if (!matches) {
    throw new UnauthorizedError("La contraseña actual es incorrecta.");
  }

  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const sameAsCurrent = await bcrypt.compare(newPassword, account.passwordHash);
  if (sameAsCurrent) {
    throw new ConflictError("La contraseña nueva debe ser distinta de la actual.", {
      code: "CONTRASENA_SIN_CAMBIO",
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await prisma.leaderAccount.update({
    where: { id: accountId },
    data: { passwordHash, mustChangePassword: false },
  });

  return { changed: true };
}

/** @param {string} accountId */
export async function getLeaderProfile(accountId) {
  const account = await prisma.leaderAccount.findUnique({
    where: { id: accountId },
    include: { person: { select: { id: true, fullName: true } } },
  });
  if (!account || !account.active) {
    throw new UnauthorizedError("La cuenta ya no está disponible.");
  }
  return {
    id: account.id,
    personId: account.personId,
    fullName: account.person.fullName,
    username: account.username,
    mustChangePassword: account.mustChangePassword,
  };
}
