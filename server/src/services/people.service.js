// Lógica de negocio del CRUD de personas (padrón). El router
// (routes/people.routes.js) solo parsea/valida/serializa; toda regla vive
// acá. Ver docs/architecture/phase2-people-contract.md (P9-P19) para la
// justificación de cada decisión.

import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { nameKey, normalizeDocument } from "../utils/normalize.js";

const PERSON_SELECT = {
  id: true,
  fullName: true,
  documentId: true,
  category: true,
  active: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
};

const MONTH_NAMES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function formatMonthLabel(monthCycle) {
  const name = MONTH_NAMES_ES[monthCycle.month - 1] ?? `mes ${monthCycle.month}`;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${monthCycle.year}`;
}

function buildOrderBy(sort) {
  switch (sort) {
    case "-fullName":
      return { fullName: "desc" };
    case "createdAt":
      return { createdAt: "asc" };
    case "-createdAt":
      return { createdAt: "desc" };
    case "fullName":
    default:
      return { fullName: "asc" };
  }
}

/**
 * @param {{ page: number, pageSize: number, search?: string, category?: string, active?: boolean, sort?: string }} query
 */
export async function listPeople({ page, pageSize, search, category, active, sort }) {
  const where = {};
  if (category) where.category = category;
  if (active !== undefined) where.active = active;
  if (search) {
    const docSearch = normalizeDocument(search);
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { documentId: { contains: docSearch, mode: "insensitive" } },
    ];
  }

  const [data, total] = await prisma.$transaction([
    prisma.person.findMany({
      where,
      orderBy: buildOrderBy(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: PERSON_SELECT,
    }),
    prisma.person.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * "Consulta puntual" de P8: nameKey no se persiste, así que se trae el
 * padrón liviano (id + fullName, sin notas ni timestamps) y se compara en
 * memoria. Tolerable con el volumen actual (cientos de filas); la salida a
 * futuro es una columna `name_key` indexada (ver limitación documentada en
 * el contrato, sección GET /api/people).
 */
async function findPersonByNameKey(key, excludeId) {
  const candidates = await prisma.person.findMany({ select: { id: true, fullName: true } });
  for (const candidate of candidates) {
    if (excludeId && candidate.id === excludeId) continue;
    if (nameKey(candidate.fullName) === key) return candidate;
  }
  return undefined;
}

/**
 * @param {{ fullName: string, documentId?: string|null, category: string, notes?: string|null, confirmDuplicateName?: boolean }} input
 */
export async function createPerson({ fullName, documentId, category, notes, confirmDuplicateName }) {
  if (documentId) {
    const clashing = await prisma.person.findUnique({ where: { documentId } });
    if (clashing) {
      throw new ConflictError("Ya existe una persona registrada con este documento.", {
        code: "DOCUMENTO_DUPLICADO",
        personId: clashing.id,
        fullName: clashing.fullName,
      });
    }
  }

  if (!confirmDuplicateName) {
    const existingByName = await findPersonByNameKey(nameKey(fullName));
    if (existingByName) {
      throw new ConflictError(`Ya existe una persona registrada con el nombre «${existingByName.fullName}».`, {
        code: "NOMBRE_DUPLICADO",
        personId: existingByName.id,
        fullName: existingByName.fullName,
      });
    }
  }

  try {
    return await prisma.person.create({
      data: {
        fullName,
        documentId: documentId ?? null,
        category,
        notes: notes ?? null,
      },
      select: PERSON_SELECT,
    });
  } catch (err) {
    // Carrera: dos altas concurrentes con el mismo documento pueden pasar
    // ambas el chequeo de arriba (no está en una transacción serializable)
    // y solo una gana en el índice único de la base. Sin este catch, la
    // segunda cae al 409 genérico de errorHandler.js (sin `details.code`),
    // rompiendo el contrato de POST /api/people (409 DOCUMENTO_DUPLICADO)
    // justo para el caso raro que más lo necesita.
    if (documentId && err?.code === "P2002") {
      const clashing = await prisma.person.findUnique({ where: { documentId } });
      if (clashing) {
        throw new ConflictError("Ya existe una persona registrada con este documento.", {
          code: "DOCUMENTO_DUPLICADO",
          personId: clashing.id,
          fullName: clashing.fullName,
        });
      }
    }
    throw err;
  }
}

async function collectActiveMembershipWarning(tx, personId) {
  // TeamMember no tiene una relación `monthCycle` propia (solo el escalar
  // monthCycleId, denormalizado para el @@unique compuesto) — el status del
  // mes se consulta a través de `team.monthCycle`.
  const membership = await tx.teamMember.findFirst({
    where: { personId, team: { monthCycle: { status: { in: ["DRAFT", "FINALIZED"] } } } },
    select: {
      team: { select: { label: true, monthCycle: { select: { year: true, month: true } } } },
    },
  });
  if (!membership) return [];
  return [
    {
      code: "PERSONA_EN_EQUIPO_ACTIVO",
      message: `Sigue asignada a ${membership.team.label} (${formatMonthLabel(membership.team.monthCycle)}). La baja solo la excluye de los sorteos futuros.`,
    },
  ];
}

/**
 * @param {string} id
 * @param {{ fullName?: string, documentId?: string|null, category?: string, notes?: string|null, active?: boolean }} patch
 */
export async function updatePerson(id, patch) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.person.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Persona no encontrada.");

    const data = {};

    if (patch.fullName !== undefined) data.fullName = patch.fullName;

    if (patch.documentId !== undefined) {
      if (patch.documentId !== null) {
        const clashing = await tx.person.findUnique({ where: { documentId: patch.documentId } });
        if (clashing && clashing.id !== id) {
          throw new ConflictError("Ya existe una persona registrada con este documento.", {
            code: "DOCUMENTO_DUPLICADO",
            personId: clashing.id,
            fullName: clashing.fullName,
          });
        }
      }
      data.documentId = patch.documentId;
    }

    if (patch.category !== undefined) data.category = patch.category;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.active !== undefined) data.active = patch.active;

    let updated;
    try {
      updated = await tx.person.update({ where: { id }, data, select: PERSON_SELECT });
    } catch (err) {
      // Misma carrera que en createPerson: dos PATCH concurrentes hacia el
      // mismo documento nuevo pueden pasar ambos el chequeo de arriba (el
      // aislamiento por defecto de Postgres, Read Committed, no bloquea la
      // fila leída por el SELECT). Sin este catch, el segundo cae al 409
      // genérico de errorHandler.js en vez del DOCUMENTO_DUPLICADO del contrato.
      if (data.documentId && err?.code === "P2002") {
        const clashing = await tx.person.findUnique({ where: { documentId: data.documentId } });
        if (clashing && clashing.id !== id) {
          throw new ConflictError("Ya existe una persona registrada con este documento.", {
            code: "DOCUMENTO_DUPLICADO",
            personId: clashing.id,
            fullName: clashing.fullName,
          });
        }
      }
      throw err;
    }

    const warnings = [];

    // P16 / invariante A4: degradar INSTRUCTOR -> MINISTRO a alguien
    // que hoy lidera algún equipo marca esas filas como excepción manual,
    // en la MISMA transacción que el cambio de categoría. No existe todavía
    // ningún TeamMember en la base (Fase 3 no arrancó), así que este bloque
    // es hoy un no-op real, pero el código queda listo para cuando existan.
    if (existing.category === "INSTRUCTOR" && data.category === "MINISTRO") {
      const leaderRows = await tx.teamMember.findMany({
        where: { personId: id, role: "LEADER" },
        select: {
          id: true,
          team: { select: { monthCycle: { select: { year: true, month: true } } } },
        },
      });
      if (leaderRows.length > 0) {
        await tx.teamMember.updateMany({
          where: { personId: id, role: "LEADER" },
          data: { manualOverride: true },
        });
        const label = formatMonthLabel(leaderRows[0].team.monthCycle);
        const count = leaderRows.length;
        warnings.push({
          code: "LIDER_DEGRADADO_A_MINISTRO",
          message: `Esta persona lidera ${count} equipo${count > 1 ? "s" : ""} (${label}). Su liderazgo quedó marcado como excepción manual.`,
        });
      }
    }

    // P19 / invariante A5: dar de baja no toca TeamMember, solo avisa.
    if (data.active === false) {
      warnings.push(...(await collectActiveMembershipWarning(tx, id)));
    }

    return { person: updated, warnings };
  });
}

/**
 * @param {string} id
 * @param {{ purge?: boolean }} [options]
 */
export async function deletePerson(id, { purge = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.person.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Persona no encontrada.");

    if (purge) {
      // P18: borrado físico solo si no hay ningún historial. Precondición
      // dura verificada DENTRO de la transacción (evita TOCTOU).
      const [teamMemberships, specialEventRoles] = await Promise.all([
        tx.teamMember.count({ where: { personId: id } }),
        tx.specialSaturdayMember.count({ where: { personId: id } }),
      ]);
      if (teamMemberships > 0 || specialEventRoles > 0) {
        throw new ConflictError("No se puede borrar físicamente: la persona tiene historial de participación.", {
          code: "PERSONA_CON_HISTORIAL",
          teamMemberships,
          specialEventRoles,
        });
      }
      await tx.person.delete({ where: { id } });
      return { deleted: true, id };
    }

    // P17: baja lógica, idempotente. Si ya estaba inactiva no se vuelve a
    // escribir, pero se responde 200 con el mismo shape (nunca 404/409).
    if (!existing.active) {
      const warnings = await collectActiveMembershipWarning(tx, id);
      const person = await tx.person.findUnique({ where: { id }, select: PERSON_SELECT });
      return { person, warnings };
    }

    const person = await tx.person.update({ where: { id }, data: { active: false }, select: PERSON_SELECT });
    const warnings = await collectActiveMembershipWarning(tx, id);
    return { person, warnings };
  });
}
