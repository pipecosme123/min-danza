import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EventsManager } from "../pages/EventsManager.jsx";
import { ToastViewport } from "../components/ui/Toast.jsx";

// Se mockean `api/months.js` (solo lo que EventsManager/useMonthSelector
// usan), `api/schedule.js` y `api/uniforms.js` completos, para poder
// controlar cada escenario (sin equipos, sin horario, horario generado,
// errores del servidor) de forma determinista. Contrato exacto:
// docs/architecture/phase4-schedule-contract.md, ampliado por
// docs/architecture/phase4b-schedule-refinements-contract.md.
vi.mock("../api/months.js", () => ({
  getMonths: vi.fn(),
  getMonthTeams: vi.fn(),
}));

vi.mock("../api/schedule.js", () => ({
  generateSchedule: vi.fn(),
  getMonthSchedule: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  updateAssignment: vi.fn(),
  updateSlotUniform: vi.fn(),
}));

vi.mock("../api/uniforms.js", () => ({
  getUniforms: vi.fn(),
}));

import { getMonths, getMonthTeams } from "../api/months.js";
import {
  generateSchedule,
  getMonthSchedule,
  createEvent,
  updateEvent,
  deleteEvent,
  updateAssignment,
  updateSlotUniform,
} from "../api/schedule.js";
import { getUniforms } from "../api/uniforms.js";
import { ApiError } from "../api/client.js";

function sampleMonth(overrides = {}) {
  return {
    id: "month-1",
    year: 2026,
    month: 8,
    teamCount: 2,
    status: "DRAFT",
    finalizedAt: null,
    youthTeamEnabled: true,
    youthTeamSize: 10,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function regularTeams() {
  return {
    teams: [
      { id: "team-1", label: "Equipo 1", orderIndex: 1, teamType: "REGULAR", members: [] },
      { id: "team-2", label: "Equipo 2", orderIndex: 2, teamType: "REGULAR", members: [] },
    ],
  };
}

function emptySchedule() {
  return { slots: [], balance: [] };
}

function fixedSlot() {
  return {
    id: "slot-fixed",
    date: "2026-08-05",
    startTime: "17:00",
    slotType: "FIXED",
    title: null,
    teamsNeeded: 1,
    countsTowardBalance: true,
    uniform: { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF" },
    teams: [{ id: "team-1", label: "Equipo 1", assignmentId: "sa-fixed", locked: false }],
  };
}

function fixedSlot2() {
  return {
    id: "slot-fixed-2",
    date: "2026-08-05",
    startTime: "19:00",
    slotType: "FIXED",
    title: null,
    teamsNeeded: 1,
    countsTowardBalance: true,
    uniform: { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF" },
    teams: [{ id: "team-2", label: "Equipo 2", assignmentId: "sa-fixed-2", locked: false }],
  };
}

function youthSlot() {
  return {
    id: "slot-youth",
    date: "2026-08-29",
    startTime: "18:50",
    slotType: "YOUTH_SERVICE",
    title: "Servicio de jóvenes",
    teamsNeeded: 1,
    countsTowardBalance: true,
    uniform: null,
    teams: [{ id: "team-youth", label: "Servicio de jóvenes", assignmentId: "sa-youth", locked: false }],
  };
}

function extraordinarySlot() {
  return {
    id: "slot-extra",
    date: "2026-08-15",
    startTime: "19:30",
    slotType: "EXTRAORDINARY",
    title: "Vigilia",
    teamsNeeded: 1,
    countsTowardBalance: true,
    uniform: null,
    teams: [{ id: "team-2", label: "Equipo 2", assignmentId: "sa-extra", locked: false }],
  };
}

function fullSchedule() {
  return {
    slots: [fixedSlot(), fixedSlot2(), extraordinarySlot(), youthSlot()],
    balance: [
      { teamId: "team-1", label: "Equipo 1", count: 5 },
      { teamId: "team-2", label: "Equipo 2", count: 4 },
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EventsManager />
      <ToastViewport />
    </MemoryRouter>,
  );
}

describe("EventsManager", () => {
  beforeEach(() => {
    getMonths.mockReset();
    getMonthTeams.mockReset();
    generateSchedule.mockReset();
    getMonthSchedule.mockReset();
    createEvent.mockReset();
    updateEvent.mockReset();
    deleteEvent.mockReset();
    updateAssignment.mockReset();
    updateSlotUniform.mockReset();
    getUniforms.mockReset();

    getUniforms.mockResolvedValue([
      { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF", active: true },
      { id: "u-2", name: "Uniforme B", colorHex: "#16A34A", active: true },
    ]);
  });

  it("muestra el selector de mes con los meses disponibles", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(emptySchedule());
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Mes")).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /Agosto 2026/ })).toBeInTheDocument();
  });

  it("muestra un estado entendible con link a Equipos cuando el mes no tiene equipos regulares", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue({ teams: [] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Primero generá los equipos de este mes")).toBeInTheDocument(),
    );
    const link = screen.getByRole("link", { name: "Ir a Equipos" });
    expect(link).toHaveAttribute("href", "/admin/equipos");
    expect(getMonthSchedule).not.toHaveBeenCalled();
  });

  it("con equipos pero sin horario, ofrece «Generar horario» y llama a generateSchedule", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValueOnce(emptySchedule()).mockResolvedValueOnce(fullSchedule());
    generateSchedule.mockResolvedValueOnce({ slots: fullSchedule().slots, warnings: [] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene horario generado")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Generar horario" }));

    await waitFor(() => expect(generateSchedule).toHaveBeenCalledWith("month-1", {}));
    await waitFor(() => expect(screen.getByText("Se generó el horario del mes.")).toBeInTheDocument());
  });

  it("renderiza el calendario con los turnos devueltos por el servidor", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    expect(screen.getAllByText("Servicio de jóvenes").length).toBeGreaterThan(0);
  });

  it("permite bloquear una asignación", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateAssignment.mockResolvedValueOnce({
      assignment: { id: "sa-fixed", serviceSlotId: "slot-fixed", teamId: "team-1", slotIndex: 0, locked: true },
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const lockButtons = screen.getAllByRole("button", { name: "Bloquear" });
    await user.click(lockButtons[0]);

    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("sa-fixed", { locked: true }));
  });

  it("permite reasignar el equipo de un turno fijo, pero no ofrece esa opción para el Servicio de jóvenes", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateAssignment.mockResolvedValueOnce({
      assignment: { id: "sa-fixed", serviceSlotId: "slot-fixed", teamId: "team-2", slotIndex: 0, locked: true },
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const reassignSelects = screen.getAllByLabelText("Equipo asignado a este turno");
    // Tres slots reasignables (2 FIXED y 1 EXTRAORDINARY), el YOUTH_SERVICE no ofrece select.
    expect(reassignSelects).toHaveLength(3);

    await user.selectOptions(reassignSelects[0], "team-2");

    await waitFor(() => expect(updateAssignment).toHaveBeenCalledWith("sa-fixed", { teamId: "team-2" }));
  });

  it("crea un evento extraordinario válido y rechaza en el cliente una fecha fuera del mes", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    createEvent.mockResolvedValueOnce({ slot: extraordinarySlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Agregar evento extraordinario" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Nuevo evento extraordinario" })).toBeInTheDocument();

    await within(dialog).findByRole("option", { name: "Uniforme A" });

    // Fecha fuera del mes del ciclo (setiembre en vez de agosto): se rechaza en el cliente.
    fireEvent.change(within(dialog).getByLabelText(/^Fecha/), { target: { value: "2026-09-01" } });
    fireEvent.change(within(dialog).getByLabelText(/^Hora/), { target: { value: "19:30" } });
    fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: "Vigilia" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear evento" }));

    expect(screen.getByText(/La fecha debe estar dentro de/)).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/^Fecha/), { target: { value: "2026-08-15" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear evento" }));

    await waitFor(() =>
      expect(createEvent).toHaveBeenCalledWith(
        "month-1",
        expect.objectContaining({ date: "2026-08-15", startTime: "19:30", title: "Vigilia", teamsNeeded: 1 }),
      ),
    );
  });

  it("elimina un evento extraordinario tras confirmar", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    deleteEvent.mockResolvedValueOnce({ deleted: true });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Eliminar evento" }));
    expect(screen.getByRole("heading", { name: "Eliminar evento" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar" }));

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith("slot-extra"));
  });

  it("edita un evento extraordinario existente llamando a updateEvent (no crea uno nuevo)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateEvent.mockResolvedValueOnce({ slot: { ...extraordinarySlot(), title: "Vigilia de oración" } });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Editar evento" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Editar evento" })).toBeInTheDocument();

    // El formulario llega precargado con los datos actuales del evento.
    expect(within(dialog).getByLabelText(/^Fecha/)).toHaveValue("2026-08-15");
    expect(within(dialog).getByLabelText(/^Hora/)).toHaveValue("19:30");
    expect(within(dialog).getByLabelText(/^Título/)).toHaveValue("Vigilia");

    fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: "Vigilia de oración" } });
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith(
        "slot-extra",
        expect.objectContaining({ title: "Vigilia de oración", date: "2026-08-15", startTime: "19:30" }),
      ),
    );
    expect(createEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Se actualizó el evento.")).toBeInTheDocument());
  });

  it("muestra un mensaje claro cuando editar un evento choca con EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateEvent.mockRejectedValueOnce(
      new ApiError("Conflicto.", {
        status: 409,
        details: { code: "EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO", locked: 2, teamsNeeded: 1 },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Editar evento" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "No se puede bajar la cantidad de equipos: ya hay 2 equipos bloqueados en este turno. Desbloqueá alguno primero.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("pide confirmación antes de regenerar el horario y el texto aclara que los eventos extraordinarios se conservan", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    generateSchedule.mockResolvedValueOnce({ slots: fullSchedule().slots, warnings: [] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Regenerar horario" }));
    expect(screen.getByRole("heading", { name: "Regenerar el horario del mes" })).toBeInTheDocument();
    expect(screen.getByText(/NO se borran/)).toBeInTheDocument();
    expect(screen.queryByText(/incluidos los eventos extraordinarios/)).not.toBeInTheDocument();
    expect(generateSchedule).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, regenerar" }));

    await waitFor(() => expect(generateSchedule).toHaveBeenCalledWith("month-1", { regenerate: true }));
  });

  it("muestra un mensaje claro cuando el servidor rechaza una reasignación con EQUIPO_NO_VALIDO", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateAssignment.mockRejectedValueOnce(
      new ApiError("Equipo inválido.", { status: 400, details: { code: "EQUIPO_NO_VALIDO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const reassignSelects = screen.getAllByLabelText("Equipo asignado a este turno");
    await user.selectOptions(reassignSelects[0], "team-2");

    await waitFor(() =>
      expect(screen.getByText("Ese equipo no es válido para este turno.")).toBeInTheDocument(),
    );
  });

  it("muestra un mensaje claro cuando el servidor rechaza el uniforme de un evento con UNIFORME_NO_VALIDO", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    createEvent.mockRejectedValueOnce(
      new ApiError("Uniforme inválido.", { status: 400, details: { code: "UNIFORME_NO_VALIDO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Agregar evento extraordinario" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("option", { name: "Uniforme A" });

    fireEvent.change(within(dialog).getByLabelText(/^Fecha/), { target: { value: "2026-08-15" } });
    fireEvent.change(within(dialog).getByLabelText(/^Hora/), { target: { value: "19:30" } });
    fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: "Vigilia" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear evento" }));

    await waitFor(() =>
      expect(screen.getByText("El uniforme elegido no existe o está inactivo. Elige otro.")).toBeInTheDocument(),
    );
  });

  it("asigna un uniforme a un turno FIJO y sincroniza el otro turno del mismo día", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateSlotUniform.mockResolvedValue({ slot: fixedSlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const uniformSelects = screen.getAllByLabelText("Uniforme de este turno");
    // slot-fixed y slot-fixed-2 comparten fecha (2026-08-05): son los dos primeros.
    await user.selectOptions(uniformSelects[0], "u-2");

    await waitFor(() => expect(updateSlotUniform).toHaveBeenCalledWith("slot-fixed", "u-2"));
    await waitFor(() => expect(updateSlotUniform).toHaveBeenCalledWith("slot-fixed-2", "u-2"));
    await waitFor(() =>
      expect(screen.getByText("Se actualizó el uniforme de ambos turnos de este día.")).toBeInTheDocument(),
    );
  });

  it("asigna un uniforme a un evento extraordinario con un único llamado (no tiene turno hermano)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateSlotUniform.mockResolvedValue({ slot: extraordinarySlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const uniformSelects = screen.getAllByLabelText("Uniforme de este turno");
    // slot-extra es el tercer select (después de los dos FIXED).
    await user.selectOptions(uniformSelects[2], "u-1");

    await waitFor(() => expect(updateSlotUniform).toHaveBeenCalledTimes(1));
    expect(updateSlotUniform).toHaveBeenCalledWith("slot-extra", "u-1");
  });

  it("alterna entre vista de lista y vista de calendario sin volver a llamar a la API", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    const callsBefore = getMonthSchedule.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Vista de calendario" }));

    // La vista de calendario es una grilla real con encabezados de día lunes a domingo.
    expect(screen.getByRole("columnheader", { name: "Lunes" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Domingo" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Vista de lista" }));
    expect(screen.getByText("Vigilia")).toBeInTheDocument();

    expect(getMonthSchedule.mock.calls.length).toBe(callsBefore);
  });
});
