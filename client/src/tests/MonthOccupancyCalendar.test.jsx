import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthOccupancyCalendar } from "../components/domain/MonthOccupancyCalendar.jsx";

function sampleSlots() {
  return [
    {
      id: "slot-fixed",
      date: "2026-08-05",
      startTime: "17:00",
      slotType: "FIXED",
      title: null,
      uniform: { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF" },
      teams: [{ id: "team-1", label: "Equipo 1", assignmentId: "sa-1" }],
    },
    {
      id: "slot-extra",
      date: "2026-08-15",
      startTime: "19:30",
      slotType: "EXTRAORDINARY",
      title: "Vigilia de oración de toda la congregación",
      uniform: null,
      teams: [{ id: "team-2", label: "Equipo 2", assignmentId: "sa-2" }],
    },
  ];
}

describe("MonthOccupancyCalendar", () => {
  it("dibuja una grilla de 7 columnas (lunes a domingo) con todos los días del mes", () => {
    render(<MonthOccupancyCalendar year={2026} month={8} slots={[]} />);

    ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].forEach((label) => {
      expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
    });

    // Agosto 2026 tiene 31 días: el número 31 debe aparecer en alguna celda.
    expect(screen.getByText("31")).toBeInTheDocument();
  });

  it("muestra un indicador por cada equipo asignado ese día, y el título truncable para eventos extraordinarios", () => {
    render(<MonthOccupancyCalendar year={2026} month={8} slots={sampleSlots()} />);

    expect(screen.getByText("Equipo 1")).toBeInTheDocument();
    expect(screen.getByText("Vigilia de oración de toda la congregación")).toBeInTheDocument();
  });

  it("los días sin turnos no muestran ningún indicador", () => {
    render(<MonthOccupancyCalendar year={2026} month={8} slots={sampleSlots()} />);

    // El día 1 de agosto de 2026 no tiene turnos en la muestra.
    const dayOne = screen.getByText("1").closest("td");
    expect(dayOne.querySelector(".month-occupancy-calendar__indicators")).not.toBeInTheDocument();
  });
});
