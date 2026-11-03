// Fase 9 · Reportes de asistencia por líderes.
//
// Un reporte por serviceSlotId (ajustado 2026-09-13, ver comentario del
// modelo en schema.prisma). Cuando un turno tiene un solo equipo asignado
// (el caso más común: turnos fijos regulares) esto se comporta exactamente
// como antes -- un reporte, un equipo, un líder. Cuando tiene 2+ equipos
// asignados (evento extraordinario, "Vigilia Unida - Comuna 21", "Ayuno
// Congregacional", turno de Congreso) el reporte cubre a TODOS los
// integrantes de TODOS esos equipos, y cualquiera de sus líderes puede
// crearlo/editarlo/enviarlo -- nunca se compite por equipo, se comparte por
// turno. `getSlotTeams`/`assertLeadsSlotTeam` son el punto único donde vive
// esa regla; el resto de las funciones ya no razona en términos de "el
// equipo del reporte" sino de "los equipos de este turno".
//
// A propósito NO hay ningún bloqueo de edición concurrente entre los líderes
// que comparten un reporte (pedido explícito del usuario, ver migración
// 20260913000000): si dos guardan al mismo tiempo, gana el último -- mismo
// comportamiento que ya existía para dos guardados seguidos del mismo líder.
//
// El líder lo crea en borrador, lo edita, lo envía y puede reabrirlo dentro
// de la ventana (attendanceWindow.js). El admin ve el contenido sólo de los
// enviados y puede editarlos/reabrirlos.
//
// Los routers (routes/leader.routes.js, routes/attendance.routes.js) sólo
// parsean/validan/serializan; toda regla vive acá.
// Contrato: docs/architecture/phase9-attendance-reports-contract.md §4-5, §7.

import { prisma } from "../lib/prisma.js";
import { NotFoundError, ConflictError, ValidationError, HttpError } from "../utils/errors.js";
import { formatDbDate, dbDateToCivilDate } from "../utils/dates.js";
import { computeAttendanceWindow, DAY_MS } from "./attendanceWindow.js";

const COVERED_STATUSES = new Set(["REMPLAZADO", "CAMBIO"]);
// Un turno con la ventana ya cerrada sigue visible en la lista del líder este
// tiempo (para seguir consultando/compartiendo lo enviado). Después desaparece.
const RECENT_CLOSED_MS = 45 * DAY_MS;

const WEEKDAY_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weekdayOf(civil) {
  return WEEKDAY_ES[new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay()];
}

/** "Domingo 28/09/2026" a partir de un `ServiceSlot.date` de Prisma. */
function longDate(slotDate) {
  const c = dbDateToCivilDate(slotDate);
  return `${weekdayOf(c)} ${String(c.day).padStart(2, "0")}/${String(c.month).padStart(2, "0")}/${c.year}`;
}

/** Rótulo visible del turno: el título si lo tiene, o "Domingo 08:00" para los fijos. */
function slotLabel(slot) {
  if (slot.title) return slot.title;
  return `${weekdayOf(dbDateToCivilDate(slot.date))} ${slot.startTime}`;
}

function teamDisplayLabel(team) {
  return team.teamType === "YOUTH" ? "Servicio de jóvenes" : team.label;
}

function serializeSlot(slot) {
  return {
    id: slot.id,
    date: formatDbDate(slot.date),
    startTime: slot.startTime,
    slotType: slot.slotType,
    title: slot.title ?? null,
    label: slotLabel(slot),
    uniform: slot.uniform ? { id: slot.uniform.id, name: slot.uniform.name, colorHex: slot.uniform.colorHex } : null,
  };
}

function serializeWindow(w) {
  return { opensAt: w.opensAt.toISOString(), closesAt: w.closesAt.toISOString(), state: w.state };
}

function compareEsName(a, b) {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

/** ["Equipo 1"] -> "Equipo 1"; ["Equipo 1","Equipo 3"] -> "Equipo 1 y Equipo
 * 3"; 3+ -> "Equipo 1, Equipo 3 y Equipo 5". Encabezado de un turno
 * compartido entre varios equipos (WhatsApp y UI). */
function joinSpanishList(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

async function assertLeadsTeamId(client, personId, teamId) {
  const membership = await client.teamMember.findFirst({
    where: { teamId, personId, role: "LEADER" },
    select: { id: true },
  });
  if (!membership) {
    throw new HttpError(403, "No lideras este equipo.", { code: "NO_ES_LIDER_DEL_EQUIPO" });
  }
}

/** Todos los equipos asignados a un turno (1 en el caso común, 2+ cuando es
 * un evento/Vigilia/Ayuno/turno de Congreso con varios equipos elegidos),
 * ordenados por orderIndex. Fuente de verdad de "a quién cubre el reporte de
 * este turno" -- NUNCA `AttendanceReport.teamId`, que sólo es el equipo bajo
 * el que se creó. */
async function getSlotTeams(serviceSlotId) {
  return prisma.team.findMany({
    where: { slotAssignments: { some: { serviceSlotId } } },
    select: { id: true, label: true, orderIndex: true, teamType: true },
    orderBy: { orderIndex: "asc" },
  });
}

/** Verifica que `personId` lidere AL MENOS UNO de los equipos asignados a
 * `serviceSlotId`. Reemplaza a `assertLeadsTeamId` en todo lo que opera
 * sobre un reporte ya existente o por crear: un reporte es del turno, no de
 * un equipo puntual, así que cualquiera de los líderes involucrados puede
 * tocarlo. */
async function assertLeadsSlotTeam(personId, serviceSlotId) {
  const membership = await prisma.teamMember.findFirst({
    where: { personId, role: "LEADER", team: { slotAssignments: { some: { serviceSlotId } } } },
    select: { id: true },
  });
  if (!membership) {
    throw new HttpError(403, "No lideras ninguno de los equipos de este turno.", {
      code: "NO_ES_LIDER_DEL_EQUIPO",
    });
  }
}

function loadReportFull(reportId) {
  return prisma.attendanceReport.findUnique({
    where: { id: reportId },
    include: {
      entries: {
        include: {
          person: { select: { id: true, fullName: true } },
          coveredBy: { select: { id: true, fullName: true } },
        },
      },
      supports: { include: { person: { select: { id: true, fullName: true } } } },
      // NO se incluye `team`: el equipo bajo el que se creó ya no es la
      // fuente de verdad de a quién pertenece el reporte (ver `getSlotTeams`
      // / comentario de cabecera); se dejó de usar acá a propósito.
      serviceSlot: {
        select: {
          id: true,
          date: true,
          startTime: true,
          slotType: true,
          title: true,
          cancelledAt: true,
          monthCycleId: true,
          uniform: { select: { id: true, name: true, colorHex: true } },
          monthCycle: { select: { id: true, year: true, month: true, status: true } },
        },
      },
    },
  });
}

/** Todas las personas de los equipos asignados a `serviceSlotId` (unión, sin
 * repetidos): el padrón real de un reporte, sea de 1 o de varios equipos. */
async function slotMembers(serviceSlotId) {
  const slotTeams = await getSlotTeams(serviceSlotId);
  return prisma.teamMember.findMany({
    where: { teamId: { in: slotTeams.map((t) => t.id) } },
    select: { personId: true },
  });
}

/** Agrega entries para integrantes nuevos de los equipos del turno (status
 * null). Devuelve cuántas agregó. Ver contrato §4.2 — sólo se llama con el
 * reporte en DRAFT. */
async function reconcileRoster(report) {
  const members = await slotMembers(report.serviceSlotId);
  const haveEntry = new Set(report.entries.map((e) => e.personId));
  const toAdd = members.filter((m) => !haveEntry.has(m.personId));
  if (toAdd.length === 0) return 0;
  await prisma.attendanceEntry.createMany({
    data: toAdd.map((m) => ({ reportId: report.id, personId: m.personId })),
    skipDuplicates: true,
  });
  return toAdd.length;
}

async function serializeReport(report, { reconcile }) {
  let full = report;
  if (reconcile && full.status === "DRAFT") {
    const added = await reconcileRoster(full);
    if (added > 0) full = await loadReportFull(full.id);
  }

  const slotTeams = await getSlotTeams(full.serviceSlotId);
  const members = await prisma.teamMember.findMany({
    where: { teamId: { in: slotTeams.map((t) => t.id) } },
    select: { personId: true, role: true },
  });
  const roleByPerson = new Map(members.map((m) => [m.personId, m.role]));
  // Turno compartido entre 2+ equipos -> 2+ líderes; todos van primero (entre
  // ellos, alfabético), no sólo "el" líder de un único equipo.
  const leaderPersonIds = new Set(members.filter((m) => m.role === "LEADER").map((m) => m.personId));

  const entries = full.entries
    .map((e) => ({
      id: e.id,
      personId: e.personId,
      fullName: e.person.fullName,
      role: roleByPerson.get(e.personId) ?? null,
      personYaNoEnEquipo: !roleByPerson.has(e.personId),
      status: e.status,
      coveredByPersonId: e.coveredByPersonId,
      coveredByFullName: e.coveredBy ? e.coveredBy.fullName : null,
      note: e.note ?? null,
    }))
    .sort((a, b) => {
      const aLeader = leaderPersonIds.has(a.personId);
      const bLeader = leaderPersonIds.has(b.personId);
      if (aLeader !== bLeader) return aLeader ? -1 : 1;
      if (a.personYaNoEnEquipo !== b.personYaNoEnEquipo) return a.personYaNoEnEquipo ? 1 : -1;
      return compareEsName(a.fullName, b.fullName);
    });

  const supports = full.supports
    .map((s) => ({ id: s.id, personId: s.personId, fullName: s.person.fullName, note: s.note ?? null }))
    .sort((a, b) => compareEsName(a.fullName, b.fullName));

  const window = computeAttendanceWindow(full.serviceSlot.date, full.serviceSlot.startTime);
  const open = window.state === "ABIERTA";

  return {
    report: {
      id: full.id,
      status: full.status,
      generalNotes: full.generalNotes ?? null,
      submittedAt: full.submittedAt ? full.submittedAt.toISOString() : null,
      reopenedAt: full.reopenedAt ? full.reopenedAt.toISOString() : null,
      lastEditedByAdmin: full.lastEditedByAdmin,
    },
    month: {
      id: full.serviceSlot.monthCycle.id,
      year: full.serviceSlot.monthCycle.year,
      month: full.serviceSlot.monthCycle.month,
      status: full.serviceSlot.monthCycle.status,
    },
    slot: serializeSlot(full.serviceSlot),
    // `teams`: 1 elemento en el caso común (un equipo por turno), 2+ cuando
    // el turno es compartido (evento/Vigilia/Ayuno/Congreso con varios
    // equipos) -- ver comentario de cabecera. `shared` es sólo un atajo para
    // que el front no tenga que mirar `teams.length` en cada lado.
    teams: slotTeams.map((t) => ({
      id: t.id,
      label: t.label,
      orderIndex: t.orderIndex,
      teamType: t.teamType,
      displayLabel: teamDisplayLabel(t),
    })),
    shared: slotTeams.length > 1,
    window: serializeWindow(window),
    entries,
    supports,
    permissions: {
      canEdit: full.status === "DRAFT" && open,
      canSubmit: full.status === "DRAFT" && open,
      canReopen: full.status === "SUBMITTED" && open,
    },
  };
}

/**
 * Valida y REEMPLAZA el contenido del reporte (entries / supports /
 * generalNotes). Compartido por el guardado del líder y la edición del admin.
 * @param {object} report  reporte cargado con loadReportFull
 * @param {{ entries?: any[], supports?: any[], generalNotes?: string|null }} body
 * @param {{ isAdmin?: boolean }} [opts]
 */
async function applyReportContent(report, body, { isAdmin = false } = {}) {
  const wantsEntries = body.entries !== undefined;
  const wantsSupports = body.supports !== undefined;
  const wantsNotes = body.generalNotes !== undefined;

  const members = await slotMembers(report.serviceSlotId);
  const memberSet = new Set(members.map((m) => m.personId));
  const existingEntrySet = new Set(report.entries.map((e) => e.personId));

  const personIdsToCheck = new Set();
  for (const e of body.entries ?? []) {
    if (e.coveredByPersonId) personIdsToCheck.add(e.coveredByPersonId);
  }
  for (const s of body.supports ?? []) personIdsToCheck.add(s.personId);
  const activeSet = new Set();
  if (personIdsToCheck.size > 0) {
    const persons = await prisma.person.findMany({
      where: { id: { in: [...personIdsToCheck] }, active: true },
      select: { id: true },
    });
    for (const p of persons) activeSet.add(p.id);
  }

  let entryRows = null;
  if (wantsEntries) {
    const seen = new Set();
    entryRows = body.entries.map((e) => {
      if (seen.has(e.personId)) {
        throw new ValidationError("Un integrante aparece dos veces en el reporte.", {
          code: "ENTRY_DUPLICADA",
          personId: e.personId,
        });
      }
      seen.add(e.personId);

      if (!memberSet.has(e.personId) && !existingEntrySet.has(e.personId)) {
        throw new ValidationError("Una de las personas no pertenece al equipo.", {
          code: "ENTRY_PERSONA_NO_ES_INTEGRANTE",
          personId: e.personId,
        });
      }

      const status = e.status ?? null;
      const isCovered = status !== null && COVERED_STATUSES.has(status);
      let coveredByPersonId = null;

      if (isCovered) {
        coveredByPersonId = e.coveredByPersonId ?? null;
        if (!coveredByPersonId) {
          throw new ValidationError("Falta indicar quién cubrió (remplazo o cambio).", {
            code: "FALTA_QUIEN_CUBRIO",
            personId: e.personId,
          });
        }
        if (coveredByPersonId === e.personId) {
          throw new ValidationError("Quien cubre no puede ser la misma persona ausente.", {
            code: "CUBRIO_ES_LA_MISMA_PERSONA",
            personId: e.personId,
          });
        }
        if (!activeSet.has(coveredByPersonId)) {
          throw new ValidationError("La persona que cubrió no existe o no está activa.", {
            code: "CUBRIO_PERSONA_NO_VALIDA",
            personId: e.personId,
          });
        }
        if (memberSet.has(coveredByPersonId)) {
          throw new ValidationError("Quien cubre debe ser alguien ajeno al equipo.", {
            code: "CUBRIO_ES_INTEGRANTE",
            personId: e.personId,
          });
        }
      }

      return {
        reportId: report.id,
        personId: e.personId,
        status,
        coveredByPersonId,
        note: typeof e.note === "string" && e.note.trim() ? e.note.trim() : null,
      };
    });
  }

  let supportRows = null;
  if (wantsSupports) {
    const seen = new Set();
    supportRows = body.supports.map((s) => {
      if (seen.has(s.personId)) {
        throw new ValidationError("Un apoyo aparece dos veces.", { code: "APOYO_DUPLICADO", personId: s.personId });
      }
      seen.add(s.personId);
      if (!activeSet.has(s.personId)) {
        throw new ValidationError("La persona de apoyo no existe o no está activa.", {
          code: "APOYO_PERSONA_NO_VALIDA",
          personId: s.personId,
        });
      }
      if (memberSet.has(s.personId)) {
        throw new ValidationError("Esa persona es integrante del equipo; marcá su asistencia en la lista.", {
          code: "APOYO_ES_INTEGRANTE",
          personId: s.personId,
        });
      }
      return {
        reportId: report.id,
        personId: s.personId,
        note: typeof s.note === "string" && s.note.trim() ? s.note.trim() : null,
      };
    });
  }

  const ops = [];
  if (wantsEntries) {
    ops.push(prisma.attendanceEntry.deleteMany({ where: { reportId: report.id } }));
    if (entryRows.length > 0) ops.push(prisma.attendanceEntry.createMany({ data: entryRows }));
  }
  if (wantsSupports) {
    ops.push(prisma.attendanceSupport.deleteMany({ where: { reportId: report.id } }));
    if (supportRows.length > 0) ops.push(prisma.attendanceSupport.createMany({ data: supportRows }));
  }
  const reportUpdate = {};
  if (wantsNotes) {
    reportUpdate.generalNotes =
      typeof body.generalNotes === "string" && body.generalNotes.trim() ? body.generalNotes.trim() : null;
  }
  if (isAdmin) reportUpdate.lastEditedByAdmin = true;
  if (Object.keys(reportUpdate).length > 0) {
    ops.push(prisma.attendanceReport.update({ where: { id: report.id }, data: reportUpdate }));
  }

  if (ops.length > 0) await prisma.$transaction(ops);
}

function assertWindowOpenForWrite(slot) {
  const window = computeAttendanceWindow(slot.date, slot.startTime);
  if (window.state === "PENDIENTE") {
    throw new ConflictError("Todavía no se puede registrar: la ventana abre una hora antes del servicio.", {
      code: "VENTANA_NO_ABIERTA",
    });
  }
  if (window.state === "CERRADA") {
    throw new ConflictError("La ventana de registro de este turno ya se cerró.", { code: "VENTANA_CERRADA" });
  }
}

// ---------------------------------------------------------------------------
// Portal del líder
// ---------------------------------------------------------------------------

/** GET /api/leader/services */
export async function listLeaderServices(personId) {
  const memberships = await prisma.teamMember.findMany({
    where: { personId, role: "LEADER" },
    select: {
      teamId: true,
      team: {
        select: {
          id: true,
          label: true,
          orderIndex: true,
          teamType: true,
          monthCycle: { select: { id: true, year: true, month: true, status: true } },
        },
      },
    },
  });

  const teams = memberships.filter((m) => m.team.monthCycle.status === "FINALIZED");
  if (teams.length === 0) return { services: [] };

  const teamById = new Map(teams.map((m) => [m.teamId, m.team]));
  const teamIds = [...teamById.keys()];

  const assignments = await prisma.slotAssignment.findMany({
    where: { teamId: { in: teamIds } },
    select: {
      teamId: true,
      serviceSlot: {
        select: {
          id: true,
          date: true,
          startTime: true,
          slotType: true,
          title: true,
          cancelledAt: true,
          uniform: { select: { id: true, name: true, colorHex: true } },
        },
      },
    },
  });

  const slotIds = [...new Set(assignments.map((a) => a.serviceSlot.id))];
  // Reportes por SLOT, no por (slot, mi equipo): si el turno es compartido,
  // puede que otro de sus líderes ya lo haya creado bajo el suyo.
  const [reports, slotTeamRows] = await Promise.all([
    slotIds.length
      ? prisma.attendanceReport.findMany({
          where: { serviceSlotId: { in: slotIds } },
          select: { id: true, serviceSlotId: true, status: true },
        })
      : [],
    slotIds.length
      ? prisma.slotAssignment.findMany({
          where: { serviceSlotId: { in: slotIds } },
          select: {
            serviceSlotId: true,
            team: { select: { id: true, label: true, orderIndex: true, teamType: true } },
          },
        })
      : [],
  ]);
  const reportBySlot = new Map(reports.map((r) => [r.serviceSlotId, r]));
  const teamsBySlot = new Map();
  for (const row of slotTeamRows) {
    const list = teamsBySlot.get(row.serviceSlotId) ?? [];
    list.push(row.team);
    teamsBySlot.set(row.serviceSlotId, list);
  }
  for (const list of teamsBySlot.values()) list.sort((a, b) => a.orderIndex - b.orderIndex);

  const now = new Date();
  const services = [];
  for (const a of assignments) {
    const slot = a.serviceSlot;
    if (slot.cancelledAt) continue;
    const window = computeAttendanceWindow(slot.date, slot.startTime, now);
    if (window.state === "CERRADA" && now.getTime() - window.closesAt.getTime() > RECENT_CLOSED_MS) continue;

    const team = teamById.get(a.teamId);
    const report = reportBySlot.get(slot.id) ?? null;
    const slotTeams = teamsBySlot.get(slot.id) ?? [team];
    services.push({
      slotId: slot.id,
      teamId: a.teamId,
      slot: serializeSlot(slot),
      team: {
        id: team.id,
        label: team.label,
        orderIndex: team.orderIndex,
        teamType: team.teamType,
        displayLabel: teamDisplayLabel(team),
      },
      // Todos los equipos de este turno (1 en el caso común, 2+ si es
      // compartido); `shared` evita que el front tenga que mirar el largo.
      teams: slotTeams.map((t) => ({
        id: t.id,
        label: t.label,
        orderIndex: t.orderIndex,
        teamType: t.teamType,
        displayLabel: teamDisplayLabel(t),
      })),
      shared: slotTeams.length > 1,
      month: { id: team.monthCycle.id, year: team.monthCycle.year, month: team.monthCycle.month },
      window: serializeWindow(window),
      report: report ? { id: report.id, status: report.status } : null,
    });
  }

  services.sort((a, b) => {
    if (a.slot.date !== b.slot.date) return a.slot.date < b.slot.date ? -1 : 1;
    if (a.slot.startTime !== b.slot.startTime) return a.slot.startTime < b.slot.startTime ? -1 : 1;
    return a.team.orderIndex - b.team.orderIndex;
  });

  return { services };
}

/**
 * GET /api/leader/people?query=
 *
 * Devuelve TODAS las personas activas del padrón (id + nombre) para poblar los
 * selectores «cubrió» / «apoyo» del editor de reporte, que filtran del lado
 * del cliente (mismo patrón que el filtro por persona de la página pública).
 * El padrón de la congregación es acotado; no hace falta paginar ni un tope.
 * `query` es un filtro server-side opcional, por si en el futuro el padrón
 * crece y conviene acotar.
 */
export async function searchPeopleForLeader(query) {
  const where = { active: true };
  if (query) where.fullName = { contains: query, mode: "insensitive" };
  const people = await prisma.person.findMany({
    where,
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true },
  });
  return { people };
}

/** POST /api/leader/services/:slotId/:teamId/report */
export async function createReportDraft(leader, slotId, teamId) {
  await assertLeadsTeamId(prisma, leader.personId, teamId);

  const assignment = await prisma.slotAssignment.findFirst({
    where: { serviceSlotId: slotId, teamId },
    select: {
      serviceSlot: {
        select: {
          id: true,
          date: true,
          startTime: true,
          cancelledAt: true,
          monthCycleId: true,
          monthCycle: { select: { status: true } },
        },
      },
    },
  });
  if (!assignment) {
    throw new NotFoundError("Este turno no está asignado a tu equipo.", { code: "TURNO_NO_ASIGNADO" });
  }
  const slot = assignment.serviceSlot;
  if (slot.cancelledAt) {
    throw new ConflictError("Este turno está cancelado.", { code: "TURNO_CANCELADO" });
  }
  if (slot.monthCycle.status !== "FINALIZED") {
    throw new ConflictError("El mes de este turno todavía no está publicado.", { code: "MES_NO_PUBLICADO" });
  }
  assertWindowOpenForWrite(slot);

  // Único por turno (no por equipo): si otro líder de un equipo compañero de
  // este mismo turno ya lo creó, éste es "ese" reporte -- no hay uno por
  // equipo. No hay ningún lock entre el chequeo y el create de abajo (a
  // propósito, ver comentario de cabecera): una carrera entre dos líderes
  // creándolo al mismo tiempo puede dar dos 201, la segunda vez pisando la
  // primera vía el índice único -- mismo tipo de condición de carrera ya
  // documentada para otras acciones de esta fase, no es nueva de esta ronda.
  const existing = await prisma.attendanceReport.findUnique({
    where: { serviceSlotId: slotId },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("Ya existe un reporte para este turno.", { code: "REPORTE_YA_EXISTE" });
  }

  const members = await slotMembers(slotId);
  const created = await prisma.attendanceReport.create({
    data: {
      serviceSlotId: slotId,
      teamId,
      monthCycleId: slot.monthCycleId,
      createdByLeaderId: leader.accountId,
      entries: { create: members.map((m) => ({ personId: m.personId })) },
    },
    select: { id: true },
  });

  return getLeaderReport(leader, created.id);
}

/** GET /api/leader/reports/:reportId */
export async function getLeaderReport(leader, reportId) {
  const report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  await assertLeadsSlotTeam(leader.personId, report.serviceSlotId);
  return serializeReport(report, { reconcile: true });
}

/** PATCH /api/leader/reports/:reportId */
export async function saveReportDraft(leader, reportId, body) {
  const report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  await assertLeadsSlotTeam(leader.personId, report.serviceSlotId);
  if (report.status !== "DRAFT") {
    throw new ConflictError("El reporte no está en borrador.", { code: "REPORTE_NO_EN_BORRADOR" });
  }
  assertWindowOpenForWrite(report.serviceSlot);

  await applyReportContent(report, body, { isAdmin: false });
  return getLeaderReport(leader, reportId);
}

/** POST /api/leader/reports/:reportId/submit */
export async function submitReport(leader, reportId) {
  let report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  await assertLeadsSlotTeam(leader.personId, report.serviceSlotId);
  if (report.status !== "DRAFT") {
    throw new ConflictError("El reporte ya fue enviado.", { code: "REPORTE_NO_EN_BORRADOR" });
  }
  assertWindowOpenForWrite(report.serviceSlot);

  await reconcileRoster(report);
  report = await loadReportFull(reportId);

  const members = await slotMembers(report.serviceSlotId);
  const memberSet = new Set(members.map((m) => m.personId));
  const pending = report.entries
    .filter((e) => memberSet.has(e.personId) && e.status == null)
    .map((e) => ({ personId: e.personId, fullName: e.person.fullName }));
  if (pending.length > 0) {
    throw new ConflictError("Faltan integrantes por marcar antes de enviar.", {
      code: "REPORTE_INCOMPLETO",
      pending,
    });
  }

  await prisma.attendanceReport.update({
    where: { id: reportId },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  return getLeaderReport(leader, reportId);
}

/** POST /api/leader/reports/:reportId/reopen */
export async function reopenReportAsLeader(leader, reportId) {
  const report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  await assertLeadsSlotTeam(leader.personId, report.serviceSlotId);
  if (report.status !== "SUBMITTED") {
    throw new ConflictError("El reporte no está enviado.", { code: "REPORTE_NO_ENVIADO" });
  }
  const window = computeAttendanceWindow(report.serviceSlot.date, report.serviceSlot.startTime);
  if (window.state !== "ABIERTA") {
    throw new ConflictError(
      "La ventana ya se cerró; pedile al administrador que reabra el reporte.",
      { code: "VENTANA_CERRADA" }
    );
  }
  await prisma.attendanceReport.update({
    where: { id: reportId },
    data: { status: "DRAFT", reopenedAt: new Date() },
  });
  return getLeaderReport(leader, reportId);
}

// ---------------------------------------------------------------------------
// Texto para WhatsApp (contrato §7). Compartido por líder y admin.
// ---------------------------------------------------------------------------

async function renderWhatsappText(report) {
  const slotTeams = await getSlotTeams(report.serviceSlotId);
  const members = await prisma.teamMember.findMany({
    where: { teamId: { in: slotTeams.map((t) => t.id) } },
    select: { personId: true, role: true },
  });
  const leaderPersonIds = new Set(members.filter((m) => m.role === "LEADER").map((m) => m.personId));

  const participated = [];
  const absent = [];
  for (const e of report.entries) {
    if (e.status === "ASISTIO") {
      participated.push({ personId: e.personId, name: e.person.fullName, cover: null });
    } else if (COVERED_STATUSES.has(e.status)) {
      participated.push({
        personId: e.personId,
        name: e.person.fullName,
        cover: e.coveredBy ? e.coveredBy.fullName : null,
      });
    } else if (e.status === "NO_ASISTIO_CON_EXCUSA" || e.status === "NO_ASISTIO_SIN_EXCUSA") {
      absent.push(e.person.fullName);
    }
  }

  participated.sort((a, b) => {
    const aLeader = leaderPersonIds.has(a.personId);
    const bLeader = leaderPersonIds.has(b.personId);
    if (aLeader !== bLeader) return aLeader ? -1 : 1;
    return compareEsName(a.name, b.name);
  });
  absent.sort(compareEsName);
  const supports = report.supports.map((s) => s.person.fullName).sort(compareEsName);

  const slot = report.serviceSlot;
  const lines = [];
  lines.push(`Asistencia — ${slotLabel(slot)}`);
  lines.push(`${longDate(slot.date)} · ${slot.startTime}`);
  lines.push(joinSpanishList(slotTeams.map(teamDisplayLabel)));
  lines.push("");

  participated.forEach((p, i) => {
    lines.push(p.cover ? `${i + 1}. ${p.name}  —  cubrió: ${p.cover}` : `${i + 1}. ${p.name}`);
  });

  if (absent.length > 0) {
    lines.push("");
    lines.push("No asistieron:");
    for (const name of absent) lines.push(`- ${name}`);
  }

  if (supports.length > 0) {
    lines.push("");
    lines.push("Apoyos:");
    for (const name of supports) lines.push(`- ${name}`);
  }

  return lines.join("\n");
}

/** GET .../reports/:reportId/whatsapp-text (líder o admin). */
export async function buildWhatsappText({ leader = null, reportId }) {
  const report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  if (leader) await assertLeadsSlotTeam(leader.personId, report.serviceSlotId);
  if (report.status !== "SUBMITTED") {
    throw new ConflictError("El reporte todavía no fue enviado.", { code: "REPORTE_NO_ENVIADO" });
  }
  return { text: await renderWhatsappText(report) };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** GET /api/months/:id/attendance */
export async function listMonthAttendance(monthCycleId) {
  const month = await prisma.monthCycle.findUnique({
    where: { id: monthCycleId },
    select: { id: true, year: true, month: true, status: true },
  });
  if (!month) throw new NotFoundError("Mes no encontrado.");

  const assignments = await prisma.slotAssignment.findMany({
    where: { monthCycleId, serviceSlot: { cancelledAt: null } },
    select: {
      teamId: true,
      serviceSlot: {
        select: { id: true, date: true, startTime: true, slotType: true, title: true },
      },
      team: { select: { id: true, label: true, orderIndex: true, teamType: true } },
    },
  });

  const reports = await prisma.attendanceReport.findMany({
    where: { monthCycleId },
    select: { id: true, serviceSlotId: true, status: true, submittedAt: true, lastEditedByAdmin: true },
  });
  const reportBySlot = new Map(reports.map((r) => [r.serviceSlotId, r]));

  // Un turno = una fila, sin importar cuántos equipos tenga asignados: un
  // reporte compartido no tiene sentido mostrado 2-3 veces con acciones
  // repetidas apuntando al mismo reportId.
  const bySlot = new Map();
  for (const a of assignments) {
    const entry = bySlot.get(a.serviceSlot.id) ?? { slot: a.serviceSlot, teams: [] };
    entry.teams.push(a.team);
    bySlot.set(a.serviceSlot.id, entry);
  }

  const now = new Date();
  const items = [...bySlot.values()].map(({ slot, teams }) => {
    teams.sort((x, y) => x.orderIndex - y.orderIndex);
    const r = reportBySlot.get(slot.id) ?? null;
    const window = computeAttendanceWindow(slot.date, slot.startTime, now);
    let status = "SIN_EMPEZAR";
    if (r) status = r.status === "SUBMITTED" ? "ENVIADO" : "BORRADOR";
    return {
      slotId: slot.id,
      teamIds: teams.map((t) => t.id),
      slot: {
        id: slot.id,
        date: formatDbDate(slot.date),
        startTime: slot.startTime,
        slotType: slot.slotType,
        title: slot.title ?? null,
        label: slotLabel(slot),
      },
      teams: teams.map((t) => ({
        id: t.id,
        label: t.label,
        orderIndex: t.orderIndex,
        teamType: t.teamType,
        displayLabel: teamDisplayLabel(t),
      })),
      shared: teams.length > 1,
      window: serializeWindow(window),
      status,
      reportId: r ? r.id : null,
      submittedAt: r && r.submittedAt ? r.submittedAt.toISOString() : null,
      lastEditedByAdmin: r ? r.lastEditedByAdmin : false,
    };
  });

  items.sort((x, y) => {
    if (x.slot.date !== y.slot.date) return x.slot.date < y.slot.date ? -1 : 1;
    if (x.slot.startTime !== y.slot.startTime) return x.slot.startTime < y.slot.startTime ? -1 : 1;
    return x.teams[0].orderIndex - y.teams[0].orderIndex;
  });

  return { month, items };
}

/** GET /api/attendance/reports/:reportId (admin: sólo enviados). */
export async function getReportForAdmin(reportId) {
  const report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  if (report.status !== "SUBMITTED") {
    throw new ConflictError("El reporte todavía está en borrador; el líder aún no lo envió.", {
      code: "REPORTE_EN_BORRADOR",
    });
  }
  return serializeReport(report, { reconcile: false });
}

/** PATCH /api/attendance/reports/:reportId (admin edita un enviado). */
export async function adminEditReport(reportId, body) {
  const report = await loadReportFull(reportId);
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  if (report.status !== "SUBMITTED") {
    throw new ConflictError("Sólo se puede editar un reporte ya enviado.", { code: "REPORTE_EN_BORRADOR" });
  }
  await applyReportContent(report, body, { isAdmin: true });
  return getReportForAdmin(reportId);
}

/** POST /api/attendance/reports/:reportId/reopen (admin: sin chequeo de ventana). */
export async function adminReopenReport(reportId) {
  const report = await prisma.attendanceReport.findUnique({
    where: { id: reportId },
    select: { id: true, status: true },
  });
  if (!report) throw new NotFoundError("Reporte no encontrado.", { code: "REPORTE_NO_ENCONTRADO" });
  if (report.status !== "SUBMITTED") {
    throw new ConflictError("El reporte no está enviado.", { code: "REPORTE_NO_ENVIADO" });
  }
  const updated = await prisma.attendanceReport.update({
    where: { id: reportId },
    data: { status: "DRAFT", reopenedAt: new Date() },
    select: { id: true, status: true },
  });
  return { reportId: updated.id, status: updated.status };
}

/** Usado por assignments.service.js para bloquear la reasignación de
 * cualquier equipo de un turno que ya tiene reporte de asistencia (el
 * reporte es del turno, no de un equipo puntual -- ver comentario de
 * cabecera). */
export async function hasAttendanceReport(serviceSlotId) {
  const r = await prisma.attendanceReport.findUnique({
    where: { serviceSlotId },
    select: { id: true },
  });
  return Boolean(r);
}
