import { describe, it, expect } from "vitest";
import { daysUntil, findNextServiceFor, findTeamIdsOf, upcomingSlots } from "../utils/myServices.js";

// Fase 10, etapa 4: cálculos de «Tu próximo servicio» / «Esta semana».

const teams = [
  { id: "t1", members: [{ personId: "p1" }, { personId: "p2" }] },
  { id: "t2", members: [{ personId: "p3" }] },
  { id: "ty", members: [{ personId: "p1" }] },
];

const slot = (id, date, startTime, teamIds, extra = {}) => ({
  id,
  date,
  startTime,
  teams: teamIds.map((teamId) => ({ id: teamId, label: teamId })),
  ...extra,
});

describe("myServices", () => {
  it("findTeamIdsOf devuelve el equipo regular y el de jóvenes de la persona", () => {
    expect([...findTeamIdsOf(teams, "p1")].sort()).toEqual(["t1", "ty"]);
    expect(findTeamIdsOf(teams, "nadie").size).toBe(0);
    expect(findTeamIdsOf(teams, null).size).toBe(0);
  });

  it("findNextServiceFor salta turnos pasados, cancelados y de otros equipos", () => {
    const now = new Date("2026-11-04T18:00:00");
    const slots = [
      slot("pasado", "2026-11-04", "17:00", ["t1"]),
      slot("otro-equipo", "2026-11-05", "08:00", ["t2"]),
      slot("cancelado", "2026-11-05", "09:00", ["t1"], { cancelledAt: "2026-11-01T00:00:00Z" }),
      slot("siguiente", "2026-11-06", "19:00", ["t1", "t2"]),
      slot("despues", "2026-11-08", "08:00", ["ty"]),
    ];
    expect(findNextServiceFor(slots, new Set(["t1", "ty"]), now)?.id).toBe("siguiente");
    expect(findNextServiceFor(slots, new Set(), now)).toBeNull();
  });

  it("findNextServiceFor incluye un turno de más tarde el mismo día", () => {
    const now = new Date("2026-11-04T16:00:00");
    const slots = [slot("hoy", "2026-11-04", "19:00", ["t1"])];
    expect(findNextServiceFor(slots, new Set(["t1"]), now)?.id).toBe("hoy");
  });

  it("upcomingSlots devuelve desde hoy hasta 7 días, sin cancelados y en orden", () => {
    const now = new Date("2026-11-04T20:00:00");
    const slots = [
      slot("ayer", "2026-11-03", "19:00", ["t1"]),
      slot("hoy-temprano", "2026-11-04", "17:00", ["t1"]),
      slot("dom", "2026-11-08", "08:00", ["t2"]),
      slot("cancelado", "2026-11-06", "19:00", ["t1"], { cancelledAt: "x" }),
      slot("fuera", "2026-11-11", "17:00", ["t1"]),
    ];
    expect(upcomingSlots(slots, now).map((s) => s.id)).toEqual(["hoy-temprano", "dom"]);
  });

  it("daysUntil cuenta días de calendario", () => {
    const now = new Date("2026-11-04T23:30:00");
    expect(daysUntil(slot("a", "2026-11-04", "08:00", []), now)).toBe(0);
    expect(daysUntil(slot("b", "2026-11-05", "08:00", []), now)).toBe(1);
    expect(daysUntil(slot("c", "2026-11-08", "08:00", []), now)).toBe(4);
  });
});
