/**
 * Cálculos de la página pública alrededor de «la persona que está mirando»
 * (Fase 10, etapa 4): sus equipos del mes, su próximo servicio y los turnos
 * de los próximos días. Todo sale de los datos que ya devuelve
 * `GET /api/schedule/*`; no hay nada nuevo en el backend.
 *
 * Las fechas de los turnos son civiles ("YYYY-MM-DD" + "HH:mm") y se comparan
 * contra el reloj del navegador, igual que `isMonthCurrentOrFuture`: el
 * público está en la misma zona horaria que la iglesia.
 */

/** Equipos (regular y/o jóvenes) que integra la persona en el mes mostrado. */
export function findTeamIdsOf(teams, personId) {
  if (!personId) return new Set();
  return new Set(
    teams.filter((team) => team.members.some((member) => member.personId === personId)).map((team) => team.id),
  );
}

/** Momento local de inicio de un turno. */
export function slotStart(slot) {
  return new Date(`${slot.date}T${slot.startTime}:00`);
}

/** ¿El turno tiene asignado alguno de estos equipos? */
export function slotHasAnyTeam(slot, teamIds) {
  return (slot.teams || []).some((team) => teamIds.has(team.id));
}

/**
 * Próximo turno no cancelado de alguno de `teamIds` que todavía no empezó.
 * `slots` ya llega ordenado por fecha/hora desde el backend, pero se ordena
 * igual para no depender de eso.
 */
export function findNextServiceFor(slots, teamIds, now = new Date()) {
  if (teamIds.size === 0) return null;
  return (
    [...slots]
      .filter((slot) => !slot.cancelledAt && slotHasAnyTeam(slot, teamIds) && slotStart(slot) >= now)
      .sort((a, b) => slotStart(a) - slotStart(b))[0] ?? null
  );
}

/**
 * Turnos no cancelados desde hoy (incluido el que ya empezó hoy) hasta los
 * próximos `days` días, para el bloque «Esta semana» del inicio.
 */
export function upcomingSlots(slots, now = new Date(), days = 7) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const limit = new Date(startOfToday);
  limit.setDate(limit.getDate() + days);
  return [...slots]
    .filter((slot) => {
      if (slot.cancelledAt) return false;
      const start = slotStart(slot);
      return start >= startOfToday && start < limit;
    })
    .sort((a, b) => slotStart(a) - slotStart(b));
}

/** Días que faltan (calendario) entre hoy y la fecha del turno: 0 = hoy, 1 = mañana. */
export function daysUntil(slot, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const slotDay = new Date(`${slot.date}T00:00:00`);
  return Math.round((slotDay - startOfToday) / 86_400_000);
}
