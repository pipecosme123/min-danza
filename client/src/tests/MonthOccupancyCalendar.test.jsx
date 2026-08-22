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

  it("un turno FIXED con título (ej. «Vigilia Unida - Comuna 21», «Ayuno Congregacional») muestra el título en vez de los equipos", () => {
    const slots = [
      {
        id: "slot-vigilia",
        date: "2026-08-07",
        startTime: "19:00",
        slotType: "FIXED",
        title: "Vigilia Unida - Comuna 21",
        uniform: null,
        teams: [
          { id: "team-1", label: "Equipo 1", assignmentId: "sa-1" },
          { id: "team-2", label: "Equipo 2", assignmentId: "sa-2" },
        ],
      },
    ];
    render(<MonthOccupancyCalendar year={2026} month={8} slots={slots} />);

    expect(screen.getByText("Vigilia Unida - Comuna 21")).toBeInTheDocument();
    expect(screen.queryByText("Equipo 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Equipo 2")).not.toBeInTheDocument();
  });

  it("los días sin turnos no muestran ningún indicador", () => {
    render(<MonthOccupancyCalendar year={2026} month={8} slots={sampleSlots()} />);

    // El día 1 de agosto de 2026 no tiene turnos en la muestra.
    const dayOne = screen.getByText("1").closest("td");
    expect(dayOne.querySelector(".month-occupancy-calendar__indicators")).not.toBeInTheDocument();
  });

  it("sin highlightTeamIds, ningún indicador tiene clase de resaltado ni de atenuado (comportamiento idéntico al anterior)", () => {
    render(<MonthOccupancyCalendar year={2026} month={8} slots={sampleSlots()} />);

    const indicator = screen.getByText("Equipo 1");
    expect(indicator).toHaveClass("month-occupancy-calendar__indicator");
    expect(indicator).not.toHaveClass("month-occupancy-calendar__indicator--highlighted");
    expect(indicator).not.toHaveClass("month-occupancy-calendar__indicator--dimmed");
  });

  it("con highlightTeamIds, resalta los indicadores del equipo elegido y atenúa el resto", () => {
    render(
      <MonthOccupancyCalendar
        year={2026}
        month={8}
        slots={sampleSlots()}
        highlightTeamIds={new Set(["team-1"])}
      />,
    );

    const highlighted = screen.getByText("Equipo 1");
    expect(highlighted).toHaveClass("month-occupancy-calendar__indicator--highlighted");
    expect(highlighted).not.toHaveClass("month-occupancy-calendar__indicator--dimmed");

    // El evento extraordinario asignado a "Equipo 2" (fuera del set) se atenúa, pero sigue visible con su texto.
    const dimmed = screen.getByText("Vigilia de oración de toda la congregación");
    expect(dimmed).toHaveClass("month-occupancy-calendar__indicator--dimmed");
    expect(dimmed).not.toHaveClass("month-occupancy-calendar__indicator--highlighted");
    expect(dimmed).toBeVisible();
  });

  it("acepta highlightTeamIds como array (no solo Set)", () => {
    render(<MonthOccupancyCalendar year={2026} month={8} slots={sampleSlots()} highlightTeamIds={["team-1"]} />);

    expect(screen.getByText("Equipo 1")).toHaveClass("month-occupancy-calendar__indicator--highlighted");
  });

  it("distingue visualmente un evento EXTRAORDINARY cancelado de uno activo (Fase 4c)", () => {
    const slots = [
      ...sampleSlots(),
      {
        id: "slot-extra-cancelled",
        date: "2026-08-20",
        startTime: "18:00",
        slotType: "EXTRAORDINARY",
        title: "Retiro cancelado",
        cancelledAt: "2026-08-10T00:00:00.000Z",
        uniform: null,
        teams: [{ id: "team-1", label: "Equipo 1", assignmentId: "sa-3" }],
      },
    ];
    render(<MonthOccupancyCalendar year={2026} month={8} slots={slots} />);

    const cancelledIndicator = screen.getByText("Retiro cancelado");
    expect(cancelledIndicator).toHaveClass("month-occupancy-calendar__indicator--cancelled");

    // El evento activo (no cancelado) no lleva esa clase.
    const activeIndicator = screen.getByText("Vigilia de oración de toda la congregación");
    expect(activeIndicator).not.toHaveClass("month-occupancy-calendar__indicator--cancelled");
  });
});
