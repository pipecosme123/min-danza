// Fase 9 · Unit de la ventana de registro de asistencia. Sin base de datos.
//   opensAt  = inicio del servicio (fecha + hora, America/Bogota) − 1 h
//   closesAt = fin del 3.º día calendario posterior (23:59:59.999, Bogota)

import { describe, it, expect } from "vitest";
import { computeAttendanceWindow, civilWallTimeToInstant } from "../src/services/attendanceWindow.js";

// `ServiceSlot.date` llega de Prisma como un Date en medianoche UTC (@db.Date).
function dbDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}

describe("civilWallTimeToInstant (America/Bogota, UTC-5 fijo)", () => {
  it("08:00 en Bogotá = 13:00 UTC", () => {
    const instant = civilWallTimeToInstant({ year: 2026, month: 9, day: 6 }, 8, 0);
    expect(instant.toISOString()).toBe("2026-09-06T13:00:00.000Z");
  });

  it("23:59:59.999 en Bogotá = 04:59:59.999 UTC del día siguiente", () => {
    const instant = civilWallTimeToInstant({ year: 2026, month: 9, day: 6 }, 23, 59, 59, 999);
    expect(instant.toISOString()).toBe("2026-09-07T04:59:59.999Z");
  });
});

describe("computeAttendanceWindow", () => {
  it("abre exactamente 1 hora antes del inicio del servicio", () => {
    const { opensAt } = computeAttendanceWindow(dbDate(2026, 9, 6), "08:00", new Date("2026-09-01T00:00:00Z"));
    // 08:00 Bogota = 13:00 UTC; menos 1 h = 12:00 UTC.
    expect(opensAt.toISOString()).toBe("2026-09-06T12:00:00.000Z");
  });

  it("cierra al final del 3.º día calendario posterior (23:59:59.999 Bogota)", () => {
    const { closesAt } = computeAttendanceWindow(dbDate(2026, 9, 6), "08:00", new Date("2026-09-01T00:00:00Z"));
    // 6 + 3 = 9 de septiembre, 23:59:59.999 Bogota = 04:59:59.999 UTC del 10.
    expect(closesAt.toISOString()).toBe("2026-09-10T04:59:59.999Z");
  });

  it("PENDIENTE antes de opensAt", () => {
    const w = computeAttendanceWindow(dbDate(2026, 9, 20), "18:00", new Date("2026-09-20T18:00:00Z"));
    expect(w.state).toBe("PENDIENTE");
  });

  it("ABIERTA entre opensAt y closesAt", () => {
    const w = computeAttendanceWindow(dbDate(2026, 9, 20), "18:00", new Date("2026-09-21T12:00:00Z"));
    expect(w.state).toBe("ABIERTA");
  });

  it("ABIERTA justo en el instante de cierre", () => {
    const w = computeAttendanceWindow(dbDate(2026, 9, 20), "18:00", new Date("2026-09-24T04:59:59.999Z"));
    expect(w.state).toBe("ABIERTA");
  });

  it("CERRADA un milisegundo después del cierre", () => {
    const w = computeAttendanceWindow(dbDate(2026, 9, 20), "18:00", new Date("2026-09-24T05:00:00.001Z"));
    expect(w.state).toBe("CERRADA");
  });

  it("el cierre cruza el fin de mes correctamente (turno el 30, cierra el 3 del mes siguiente)", () => {
    const { closesAt } = computeAttendanceWindow(dbDate(2026, 9, 30), "10:30", new Date("2026-09-01T00:00:00Z"));
    // 30/09 + 3 = 03/10, 23:59:59.999 Bogota = 04:59:59.999 UTC del 04/10.
    expect(closesAt.toISOString()).toBe("2026-10-04T04:59:59.999Z");
  });

  it("el cierre cruza el fin de año (turno el 31/12, cierra el 3/01)", () => {
    const { closesAt } = computeAttendanceWindow(dbDate(2026, 12, 31), "19:00", new Date("2026-12-01T00:00:00Z"));
    expect(closesAt.toISOString()).toBe("2027-01-04T04:59:59.999Z");
  });

  it("último sábado 18:50 (Servicio de jóvenes): abre 17:50 Bogota", () => {
    const { opensAt } = computeAttendanceWindow(dbDate(2026, 9, 26), "18:50", new Date("2026-09-01T00:00:00Z"));
    // 18:50 Bogota = 23:50 UTC; menos 1 h = 22:50 UTC.
    expect(opensAt.toISOString()).toBe("2026-09-26T22:50:00.000Z");
  });
});
