// Fase 9 · Alta y gestión de cuentas de líder (LeaderAccount).
//
// - `ensureLeaderAccounts(monthCycleId)`: provisionamiento automático. Se
//   llama al finalizar un mes (teamGeneration.service.js#finalizeMonthCycle) y
//   cuando aparece un líder nuevo en un mes ya FINALIZED
//   (teamGeneration.service.js#updateTeam). Idempotente.
// - CRUD administrativo: crear a mano, listar, editar username/active, reset
//   de contraseña. Rutas en routes/leaderAccounts.routes.js.
//
// La contraseña temporal se genera acá, se devuelve UNA sola vez al admin y
// NUNCA se persiste en claro (sólo el hash bcrypt).
// Contrato: docs/architecture/phase9-attendance-reports-contract.md §5.4.

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { NotFoundError, ConflictError, ValidationError } from "../utils/errors.js";
import { nameKey } from "../utils/normalize.js";

const BCRYPT_COST = 12;
// Alfabeto sin caracteres ambiguos (0/O, 1/l/I) para dictar la contraseña por
// teléfono / WhatsApp sin errores.
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generateTempPassword(length = 12) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  }
  return out;
}

/** "Marta Restrepo Gómez" -> "marta.r" (base; el sufijo numérico lo agrega
 * `uniqueUsername`). Sólo letras/dígitos ASCII y el punto separador. */
function usernameBase(fullName, documentId) {
  if (documentId) {
    const digits = documentId.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    if (digits.length >= 3) return digits;
  }
  const parts = nameKey(fullName)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "lider";
  const first = parts[0];
  const initial = parts[1] ? `.${parts[1][0]}` : "";
  return `${first}${initial}`;
}

async function uniqueUsername(tx, base) {
  let candidate = base;
  let n = 1;
  // Bucle acotado en la práctica (un puñado de homónimos como mucho).
  while (await tx.leaderAccount.findUnique({ where: { username: candidate }, select: { id: true } })) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

async function createAccountForPerson(tx, person) {
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);
  const username = await uniqueUsername(tx, usernameBase(person.fullName, person.documentId));
  const account = await tx.leaderAccount.create({
    data: { personId: person.id, username, passwordHash, mustChangePassword: true },
  });
  return {
    accountId: account.id,
    personId: person.id,
    fullName: person.fullName,
    username,
    tempPassword,
  };
}

/**
 * Crea (si no existe) una LeaderAccount para cada persona que sea LEADER de un
 * equipo (REGULAR o YOUTH) del mes dado. Idempotente: si la persona ya tiene
 * cuenta, no hace nada.
 *
 * Acepta un cliente Prisma opcional (`client`) para poder correr dentro de la
 * transacción de `finalizeMonthCycle`, o suelto desde `updateTeam`.
 *
 * @param {string} monthCycleId
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} [client]
 * @returns {Promise<{ newLeaderAccounts: Array<{personId,fullName,username,tempPassword}> }>}
 */
export async function ensureLeaderAccounts(monthCycleId, client = prisma) {
  const leaders = await client.teamMember.findMany({
    where: { monthCycleId, role: "LEADER" },
    select: { person: { select: { id: true, fullName: true, documentId: true } } },
  });

  const seen = new Set();
  const uniquePeople = [];
  for (const { person } of leaders) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    uniquePeople.push(person);
  }

  if (uniquePeople.length === 0) return { newLeaderAccounts: [] };

  const existing = await client.leaderAccount.findMany({
    where: { personId: { in: uniquePeople.map((p) => p.id) } },
    select: { personId: true },
  });
  const hasAccount = new Set(existing.map((e) => e.personId));

  const newLeaderAccounts = [];
  for (const person of uniquePeople) {
    if (hasAccount.has(person.id)) continue;
    // Secuencial a propósito: `uniqueUsername` lee cuentas recién creadas en
    // este mismo bucle para no colisionar entre homónimos del mismo mes.
    const created = await createAccountForPerson(client, person);
    newLeaderAccounts.push({
      personId: created.personId,
      fullName: created.fullName,
      username: created.username,
      tempPassword: created.tempPassword,
    });
  }

  return { newLeaderAccounts };
}

// --------------------------- CRUD administrativo ---------------------------

/** @param {string} personId */
export async function createLeaderAccount(personId) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, fullName: true, documentId: true, active: true },
  });
  if (!person) throw new NotFoundError("Persona no encontrada.", { code: "PERSONA_NO_ENCONTRADA" });

  const already = await prisma.leaderAccount.findUnique({ where: { personId }, select: { id: true } });
  if (already) {
    throw new ConflictError("Esta persona ya tiene una cuenta de líder.", { code: "CUENTA_YA_EXISTE" });
  }

  const created = await prisma.$transaction((tx) => createAccountForPerson(tx, person));
  return {
    account: {
      id: created.accountId,
      personId: created.personId,
      fullName: created.fullName,
      username: created.username,
      mustChangePassword: true,
      active: true,
    },
    tempPassword: created.tempPassword,
  };
}

export async function listLeaderAccounts() {
  const accounts = await prisma.leaderAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: { person: { select: { id: true, fullName: true, active: true } } },
  });

  // Meses en que cada persona fue líder (para orientar al admin).
  const personIds = accounts.map((a) => a.personId);
  const leaderships = personIds.length
    ? await prisma.teamMember.findMany({
        where: { personId: { in: personIds }, role: "LEADER" },
        select: {
          personId: true,
          team: { select: { monthCycle: { select: { year: true, month: true } } } },
        },
      })
    : [];

  const monthsByPerson = new Map();
  for (const l of leaderships) {
    const { year, month } = l.team.monthCycle;
    const arr = monthsByPerson.get(l.personId) ?? [];
    if (!arr.some((m) => m.year === year && m.month === month)) arr.push({ year, month });
    monthsByPerson.set(l.personId, arr);
  }

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      personId: a.personId,
      fullName: a.person.fullName,
      personActive: a.person.active,
      username: a.username,
      mustChangePassword: a.mustChangePassword,
      active: a.active,
      lastLoginAt: a.lastLoginAt,
      ledMonths: (monthsByPerson.get(a.personId) ?? []).sort(
        (x, y) => y.year - x.year || y.month - x.month
      ),
    })),
  };
}

/**
 * @param {string} accountId
 * @param {{ username?: string, active?: boolean }} data
 */
export async function updateLeaderAccount(accountId, data) {
  const account = await prisma.leaderAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError("Cuenta no encontrada.", { code: "CUENTA_NO_ENCONTRADA" });

  const updateData = {};
  if (data.username !== undefined) {
    const username = data.username.trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/i.test(username)) {
      throw new ValidationError(
        "El usuario admite 3 a 40 caracteres: letras, dígitos, punto, guion y guion bajo."
      );
    }
    const clash = await prisma.leaderAccount.findUnique({ where: { username }, select: { id: true } });
    if (clash && clash.id !== accountId) {
      throw new ConflictError("Ese usuario ya está en uso.", { code: "USERNAME_EN_USO" });
    }
    updateData.username = username;
  }
  if (typeof data.active === "boolean") updateData.active = data.active;

  const updated = await prisma.leaderAccount.update({ where: { id: accountId }, data: updateData });
  return {
    account: {
      id: updated.id,
      personId: updated.personId,
      username: updated.username,
      mustChangePassword: updated.mustChangePassword,
      active: updated.active,
    },
  };
}

/** @param {string} accountId */
export async function resetLeaderPassword(accountId) {
  const account = await prisma.leaderAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError("Cuenta no encontrada.", { code: "CUENTA_NO_ENCONTRADA" });

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);
  await prisma.leaderAccount.update({
    where: { id: accountId },
    data: { passwordHash, mustChangePassword: true },
  });
  return { tempPassword };
}
