// CRUD de Uniform + configuración de WeekdayUniform / YouthServiceUniform.
// Contrato cerrado: docs/architecture/phase4-schedule-contract.md §7. El
// router (routes/uniforms.routes.js) solo parsea/valida/serializa; toda
// regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";

const UNIFORM_SELECT = { id: true, name: true, colorHex: true, description: true, active: true };

export async function listUniforms() {
  const data = await prisma.uniform.findMany({ orderBy: { name: "asc" }, select: UNIFORM_SELECT });
  return { data };
}

/**
 * @param {{ name: string, colorHex?: string, description?: string }} data
 */
export async function createUniform(data) {
  try {
    return await prisma.uniform.create({ data, select: UNIFORM_SELECT });
  } catch (err) {
    if (err?.code === "P2002") {
      throw new ConflictError("Ya existe un uniforme con ese nombre.", { code: "UNIFORME_DUPLICADO" });
    }
    throw err;
  }
}

/**
 * @param {string} id
 * @param {{ name?: string, colorHex?: string, description?: string, active?: boolean }} data
 */
export async function updateUniform(id, data) {
  const existing = await prisma.uniform.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Uniforme no encontrado.");

  try {
    return await prisma.uniform.update({ where: { id }, data, select: UNIFORM_SELECT });
  } catch (err) {
    if (err?.code === "P2002") {
      throw new ConflictError("Ya existe un uniforme con ese nombre.", { code: "UNIFORME_DUPLICADO" });
    }
    throw err;
  }
}

async function assertUniformExists(id) {
  const uniform = await prisma.uniform.findUnique({ where: { id }, select: { id: true } });
  if (!uniform) {
    throw new ValidationError("El uniforme indicado no existe.", { code: "UNIFORME_NO_VALIDO" });
  }
}

// ---------------------------------------------------------------------------
// Config por día de semana (miércoles / domingo)
// ---------------------------------------------------------------------------

export async function listWeekdayUniforms() {
  const rows = await prisma.weekdayUniform.findMany({ select: { weekday: true, uniformId: true } });
  return { data: rows };
}

/**
 * @param {"WEDNESDAY" | "SUNDAY"} weekday
 * @param {string} uniformId
 */
export async function updateWeekdayUniform(weekday, uniformId) {
  await assertUniformExists(uniformId);

  const row = await prisma.weekdayUniform.upsert({
    where: { weekday },
    create: { weekday, uniformId },
    update: { uniformId },
    select: { weekday: true, uniformId: true },
  });
  return row;
}

// ---------------------------------------------------------------------------
// Config del Servicio de jóvenes (singleton)
// ---------------------------------------------------------------------------

export async function getYouthServiceUniform() {
  const row = await prisma.youthServiceUniform.findFirst({ select: { uniformId: true } });
  return { uniformId: row?.uniformId ?? null };
}

/**
 * @param {string} uniformId
 */
export async function updateYouthServiceUniform(uniformId) {
  await assertUniformExists(uniformId);

  const existing = await prisma.youthServiceUniform.findFirst({ select: { id: true } });
  const row = existing
    ? await prisma.youthServiceUniform.update({ where: { id: existing.id }, data: { uniformId }, select: { uniformId: true } })
    : await prisma.youthServiceUniform.create({ data: { uniformId }, select: { uniformId: true } });

  return row;
}
