// CRUD puro de Uniform. Contrato cerrado:
// docs/architecture/phase4-schedule-contract.md §7, recortado por
// docs/architecture/phase4b-schedule-refinements-contract.md §1.4 (ya no hay
// configuración automática por día de semana ni para el Servicio de
// jóvenes — cada ServiceSlot lleva su propio uniformId, ver
// slots.service.js). El router (routes/uniforms.routes.js) solo
// parsea/valida/serializa; toda regla vive acá.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

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
