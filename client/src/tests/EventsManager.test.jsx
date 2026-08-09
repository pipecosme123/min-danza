import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  cancelEvent: vi.fn(),
  updateAssignment: vi.fn(),
  updateSlotUniform: vi.fn(),
  finalizeMonth: vi.fn(),
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
  cancelEvent,
  updateAssignment,
  updateSlotUniform,
  finalizeMonth,
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

function cancelledExtraordinarySlot() {
  return { ...extraordinarySlot(), cancelledAt: "2026-08-08T12:00:00.000Z", countsTowardBalance: false, teams: [] };
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
    cancelEvent.mockReset();
    updateAssignment.mockReset();
    updateSlotUniform.mockReset();
    finalizeMonth.mockReset();
    getUniforms.mockReset();

    getUniforms.mockResolvedValue([
      { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF", active: true },
      { id: "u-2", name: "Uniforme B", colorHex: "#16A34A", active: true },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("el botón «Finalizar mes» está deshabilitado y explica el motivo cuando faltan equipos y horario", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue({ teams: [] });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Finalizar mes" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Finalizar mes" })).toBeDisabled();
    expect(
      screen.getByText("Todavía falta generar los equipos y el horario de este mes."),
    ).toBeInTheDocument();
    expect(finalizeMonth).not.toHaveBeenCalled();
  });

  it("el botón «Finalizar mes» está deshabilitado si ya hay equipos pero falta el horario", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(emptySchedule());
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene horario generado")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Finalizar mes" })).toBeDisabled();
    expect(screen.getByText("Todavía falta generar el horario de este mes.")).toBeInTheDocument();
  });

  it("el botón «Finalizar mes» está deshabilitado si el mes ya está finalizado", async () => {
    getMonths.mockResolvedValue({
      data: [sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-08T00:00:00.000Z" })],
    });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Finalizar mes" })).toBeDisabled();
  });

  it("habilitado con equipos y horario, pide confirmación y llama a finalizeMonth", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    finalizeMonth.mockResolvedValueOnce(
      sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-08T00:00:00.000Z" }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    const finalizeButton = screen.getByRole("button", { name: "Finalizar mes" });
    expect(finalizeButton).not.toBeDisabled();

    await user.click(finalizeButton);
    expect(screen.getByRole("heading", { name: "Finalizar el mes" })).toBeInTheDocument();
    expect(finalizeMonth).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, finalizar mes" }));

    await waitFor(() => expect(finalizeMonth).toHaveBeenCalledWith("month-1"));
    await waitFor(() =>
      expect(screen.getByText("Se finalizó el mes: ya está visible en la página pública.")).toBeInTheDocument(),
    );
  });

  it("muestra un mensaje claro cuando finalizar falla con MES_INCOMPLETO", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    finalizeMonth.mockRejectedValueOnce(
      new ApiError("Conflicto.", {
        status: 409,
        details: { code: "MES_INCOMPLETO", hasTeams: true, hasSchedule: false },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Finalizar mes" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, finalizar mes" }));

    await waitFor(() =>
      expect(screen.getByText("Todavía falta generar el horario de este mes.")).toBeInTheDocument(),
    );
  });

  // Fase 4c: docs/architecture/phase4c-post-publish-edits-contract.md §0/§8.
  // Un mes FINALIZED "actual o futuro" relaja solo agregar/cancelar/eliminar
  // evento y el uniforme por turno; el resto sigue bloqueado por completo.
  it("con un mes finalizado actual, agregar/cancelar/eliminar evento y el uniforme siguen habilitados, pero regenerar/bloquear/reasignar/editar evento completo siguen deshabilitados", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 8)); // 8 de agosto de 2026: mismo mes/año que sampleMonth().

    getMonths.mockResolvedValue({
      data: [sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-01T00:00:00.000Z" })],
    });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    // Grupo nuevo: habilitado.
    expect(screen.getByRole("button", { name: "Agregar evento extraordinario" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar evento" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar evento" })).not.toBeDisabled();
    screen.getAllByLabelText("Uniforme de este turno").forEach((select) => expect(select).not.toBeDisabled());

    // Grupo viejo: sigue deshabilitado, sin excepción de fecha.
    expect(screen.getByRole("button", { name: "Regenerar horario" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Editar evento" })).toBeDisabled();
    screen.getAllByRole("button", { name: "Bloquear" }).forEach((button) => expect(button).toBeDisabled());
    screen.getAllByLabelText("Equipo asignado a este turno").forEach((select) => expect(select).toBeDisabled());
  });

  it("con un mes finalizado ya pasado, todo sigue deshabilitado (comportamiento viejo)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8)); // 8 de setiembre de 2026: sampleMonth() (agosto 2026) ya pasó.

    getMonths.mockResolvedValue({
      data: [sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-01T00:00:00.000Z" })],
    });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Agregar evento extraordinario" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar evento" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar evento" })).toBeDisabled();
    screen.getAllByLabelText("Uniforme de este turno").forEach((select) => expect(select).toBeDisabled());
    expect(screen.getByRole("button", { name: "Regenerar horario" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Editar evento" })).toBeDisabled();
  });

  it("cancela un evento extraordinario tras confirmar y muestra «Cancelado» tras refrescar", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValueOnce(fullSchedule()).mockResolvedValueOnce({
      slots: [fixedSlot(), fixedSlot2(), cancelledExtraordinarySlot(), youthSlot()],
      balance: fullSchedule().balance,
    });
    cancelEvent.mockResolvedValueOnce({ slot: cancelledExtraordinarySlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
    expect(screen.getByRole("heading", { name: "Cancelar evento" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, cancelar evento" }));

    await waitFor(() => expect(cancelEvent).toHaveBeenCalledWith("slot-extra"));
    await waitFor(() => expect(screen.getByText("Se canceló el evento.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Cancelado")).toBeInTheDocument());
    expect(screen.getByText("Este evento fue cancelado.")).toBeInTheDocument();
  });

  it("no ofrece «Cancelar evento» para un evento que ya está cancelado, pero sí «Eliminar evento»", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue({
      slots: [fixedSlot(), fixedSlot2(), cancelledExtraordinarySlot(), youthSlot()],
      balance: fullSchedule().balance,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Cancelado")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Cancelar evento" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar evento" })).toBeInTheDocument();
  });

  it("en un mes DRAFT, cambiar el uniforme de un turno fijo sigue sincronizando el turno hermano del mismo día (sin cambios)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth({ status: "DRAFT" })] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateSlotUniform.mockResolvedValue({ slot: fixedSlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const uniformSelects = screen.getAllByLabelText("Uniforme de este turno");
    await user.selectOptions(uniformSelects[0], "u-2");

    await waitFor(() => expect(updateSlotUniform).toHaveBeenCalledWith("slot-fixed", "u-2"));
    await waitFor(() => expect(updateSlotUniform).toHaveBeenCalledWith("slot-fixed-2", "u-2"));
    expect(updateSlotUniform).toHaveBeenCalledTimes(2);
  });

  it("en un mes FINALIZED actual/futuro, cambiar el uniforme de un turno fijo afecta SOLO ese turno (no sincroniza el hermano)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 8)); // agosto 2026: mismo mes que sampleMonth(), mes actual.

    getMonths.mockResolvedValue({
      data: [sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-01T00:00:00.000Z" })],
    });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    updateSlotUniform.mockResolvedValue({ slot: fixedSlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    const uniformSelects = screen.getAllByLabelText("Uniforme de este turno");
    await user.selectOptions(uniformSelects[0], "u-2");

    await waitFor(() => expect(updateSlotUniform).toHaveBeenCalledTimes(1));
    expect(updateSlotUniform).toHaveBeenCalledWith("slot-fixed", "u-2");
    expect(updateSlotUniform).not.toHaveBeenCalledWith("slot-fixed-2", "u-2");
  });

  it("mapea MES_PASADO a un mensaje claro (eliminar evento)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    deleteEvent.mockRejectedValueOnce(
      new ApiError("Conflicto.", { status: 409, details: { code: "MES_PASADO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Eliminar evento" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar" }));

    await waitFor(() =>
      expect(screen.getByText("Este mes ya pasó, no se puede modificar.")).toBeInTheDocument(),
    );
  });

  it("mapea EVENTO_YA_CANCELADO a un mensaje claro (cancelar evento)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    cancelEvent.mockRejectedValueOnce(
      new ApiError("Conflicto.", { status: 409, details: { code: "EVENTO_YA_CANCELADO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, cancelar evento" }));

    await waitFor(() =>
      expect(screen.getByText("Este evento ya está cancelado.")).toBeInTheDocument(),
    );
  });
});
