// Casos límite de server/src/utils/dates.js que hoy NO se ejercitan en
// ningún test existente (el recorrido de 12 meses de scheduleGeneration.test.js
// no elige casos límite a propósito) — hallazgo de auditoría QA Fase 7.
// Pruebas puras de aritmética de calendario, no golpean la base.

import { describe, it, expect } from "vitest";
import {
  lastSundayOf,
  lastSaturdayOf,
  weekdaysIn,
  mondayOfWeek,
  isSameCivilDate,
  formatCivilDate,
  currentCivilDate,
} from "../src/utils/dates.js";

describe("lastSundayOf — el último día del mes cae exactamente en domingo", () => {
  it("2093-05 tiene 31 días y el día 31 ES domingo: lastSundayOf debe devolver ESE día, no el domingo anterior", () => {
    expect(lastSundayOf(2093, 5)).toEqual({ year: 2093, month: 5, day: 31 });
  });
});

describe("Febrero bisiesto (2096, 29 días — 2094 usado en otros tests NO es bisiesto)", () => {
  it("weekdaysIn devuelve las fechas correctas incluyendo el día 29", () => {
    // Verificado a mano contra el calendario proléptico: en 2096-02 los
    // domingos caen 5, 12, 19, 26 y los sábados 4, 11, 18, 25; el día 29
    // (miércoles) es el último día del mes.
    expect(weekdaysIn(2096, 2, 0)).toEqual([
      { year: 2096, month: 2, day: 5 },
      { year: 2096, month: 2, day: 12 },
      { year: 2096, month: 2, day: 19 },
      { year: 2096, month: 2, day: 26 },
    ]);
    expect(weekdaysIn(2096, 2, 3)).toEqual([
      { year: 2096, month: 2, day: 1 },
      { year: 2096, month: 2, day: 8 },
      { year: 2096, month: 2, day: 15 },
      { year: 2096, month: 2, day: 22 },
      { year: 2096, month: 2, day: 29 },
    ]);
  });

  it("lastSundayOf y lastSaturdayOf del Febrero bisiesto caen dentro de los 29 días reales", () => {
    expect(lastSundayOf(2096, 2)).toEqual({ year: 2096, month: 2, day: 26 });
    expect(lastSaturdayOf(2096, 2)).toEqual({ year: 2096, month: 2, day: 25 });
  });

  it("un Febrero NO bisiesto (2094, usado en otros tests) tiene 28 días: ninguna fecha de weekdaysIn cae en el día 29", () => {
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const dates = weekdaysIn(2094, 2, weekday);
      expect(dates.every((d) => d.day <= 28)).toBe(true);
    }
  });
});

describe("Meses de 30 días vs. 31 días", () => {
  it("un mes de 30 días (abril) nunca genera una fecha con day=31 en weekdaysIn", () => {
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const dates = weekdaysIn(2093, 4, weekday);
      expect(dates.every((d) => d.day <= 30)).toBe(true);
    }
    // El último día de abril 2093 (día 30) es jueves (weekday=4); confirmado
    // a mano contra el calendario proléptico.
    expect(lastSundayOf(2093, 4).day).toBeLessThanOrEqual(30);
    expect(lastSaturdayOf(2093, 4).day).toBeLessThanOrEqual(30);
  });

  it("un mes de 31 días (mayo) sí puede llegar hasta day=31", () => {
    expect(lastSundayOf(2093, 5).day).toBe(31);
  });
});

describe("mondayOfWeek — casos límite de los extremos de la semana ISO", () => {
  it("una fecha que YA es lunes devuelve la MISMA fecha", () => {
    // 2093-04-06 es lunes (confirmado a mano).
    expect(mondayOfWeek({ year: 2093, month: 4, day: 6 })).toEqual({ year: 2093, month: 4, day: 6 });
  });

  it("un domingo devuelve el lunes de ESA semana (6 días atrás), no el siguiente", () => {
    // 2093-04-05 es domingo; el lunes de esa semana ISO es 2093-03-30
    // (mismo bloque lunes-domingo), NO 2093-04-06 (el lunes siguiente).
    expect(mondayOfWeek({ year: 2093, month: 4, day: 5 })).toEqual({ year: 2093, month: 3, day: 30 });
  });
});

describe("isSameCivilDate / formatCivilDate — sanity checks de apoyo", () => {
  it("formatCivilDate cero-rellena mes y día", () => {
    expect(formatCivilDate({ year: 2096, month: 2, day: 5 })).toBe("2096-02-05");
  });

  it("isSameCivilDate distingue correctamente fechas iguales y distintas", () => {
    expect(isSameCivilDate({ year: 2096, month: 2, day: 29 }, { year: 2096, month: 2, day: 29 })).toBe(true);
    expect(isSameCivilDate({ year: 2096, month: 2, day: 29 }, { year: 2096, month: 2, day: 28 })).toBe(false);
  });
});

describe("currentCivilDate — sanity check contra el reloj real en UTC", () => {
  it("devuelve la misma fecha civil que Date#toISOString() en UTC", () => {
    const now = new Date();
    const [expectedYear, expectedMonth, expectedDay] = now
      .toISOString()
      .slice(0, 10)
      .split("-")
      .map(Number);
    expect(currentCivilDate("UTC")).toEqual({ year: expectedYear, month: expectedMonth, day: expectedDay });
  });
});
