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
  deleteMonth: vi.fn(),
}));

vi.mock("../api/schedule.js", () => ({
  generateSchedule: vi.fn(),
  getMonthSchedule: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  cancelEvent: vi.fn(),
  cancelYouthService: vi.fn(),
  updateAssignment: vi.fn(),
  updateSlotUniform: vi.fn(),
  finalizeMonth: vi.fn(),
}));

vi.mock("../api/uniforms.js", () => ({
  getUniforms: vi.fn(),
}));

// Parte 2/4 (plan wise-noodling-hickey.md): EventsManager monta
// EventGroupsSection/MonthVersesSection, que dependen de estos dos módulos.
// Se mockean acá también para que los tests existentes no dependan de una
// llamada de red real, y para poder ejercitar los flujos nuevos.
vi.mock("../api/eventGroups.js", () => ({
  createEventGroup: vi.fn(),
  listEventGroups: vi.fn(),
  updateEventGroupTitle: vi.fn(),
  addEventGroupTurno: vi.fn(),
  updateEventGroupTurno: vi.fn(),
  deleteEventGroupTurno: vi.fn(),
  cancelEventGroup: vi.fn(),
  deleteEventGroup: vi.fn(),
}));

vi.mock("../api/verses.js", () => ({
  listVerses: vi.fn(),
  addVerse: vi.fn(),
  updateVerse: vi.fn(),
  deleteVerse: vi.fn(),
}));

import { getMonths, getMonthTeams, deleteMonth } from "../api/months.js";
import {
  generateSchedule,
  getMonthSchedule,
  createEvent,
  updateEvent,
  deleteEvent,
  cancelEvent,
  cancelYouthService,
  updateAssignment,
  updateSlotUniform,
  finalizeMonth,
} from "../api/schedule.js";
import { getUniforms } from "../api/uniforms.js";
import {
  createEventGroup,
  listEventGroups,
  updateEventGroupTitle,
  addEventGroupTurno,
  updateEventGroupTurno,
  deleteEventGroupTurno,
  cancelEventGroup,
  deleteEventGroup,
} from "../api/eventGroups.js";
import { listVerses, addVerse, deleteVerse } from "../api/verses.js";
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
    uniform: { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF" },
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
    uniform: { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF" },
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

function cancelledYouthSlot() {
  return { ...youthSlot(), cancelledAt: "2026-08-08T12:00:00.000Z", countsTowardBalance: false, teams: [] };
}

// Parte 1 (plan wise-noodling-hickey.md): un mes con 3 equipos regulares,
// para probar que "Cantidad de equipos" del formulario de evento ofrece
// hasta 3 opciones (antes fijo en 1/2).
function threeRegularTeams() {
  return {
    teams: [
      { id: "team-1", label: "Equipo 1", orderIndex: 1, teamType: "REGULAR", members: [] },
      { id: "team-2", label: "Equipo 2", orderIndex: 2, teamType: "REGULAR", members: [] },
      { id: "team-3", label: "Equipo 3", orderIndex: 3, teamType: "REGULAR", members: [] },
    ],
  };
}

function threeTeamSchedule() {
  return {
    slots: [fixedSlot(), fixedSlot2()],
    balance: [
      { teamId: "team-1", label: "Equipo 1", count: 3 },
      { teamId: "team-2", label: "Equipo 2", count: 2 },
      { teamId: "team-3", label: "Equipo 3", count: 1 },
    ],
  };
}

// Parte 2: un turno de evento agrupado (Congreso) tal como llega dentro del
// horario general, con la referencia al grupo denormalizada en el slot.
function groupedSlot(overrides = {}) {
  return {
    id: "slot-congreso-1",
    date: "2026-08-12",
    startTime: "09:00",
    slotType: "EXTRAORDINARY",
    title: "Congreso de danza",
    teamsNeeded: 2,
    countsTowardBalance: true,
    uniform: null,
    teams: [
      { id: "team-1", label: "Equipo 1", assignmentId: "sa-congreso-1a", locked: true },
      { id: "team-2", label: "Equipo 2", assignmentId: "sa-congreso-1b", locked: true },
    ],
    eventGroupId: "group-1",
    eventGroupTitle: "Congreso de danza",
    ...overrides,
  };
}

function sampleEventGroup() {
  return {
    id: "group-1",
    title: "Congreso de danza",
    slots: [
      groupedSlot(),
      groupedSlot({
        id: "slot-congreso-2",
        date: "2026-08-13",
        startTime: "09:00",
        teams: [{ id: "team-1", label: "Equipo 1", assignmentId: "sa-congreso-2a", locked: true }],
        teamsNeeded: 1,
      }),
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
    deleteMonth.mockReset();
    generateSchedule.mockReset();
    getMonthSchedule.mockReset();
    createEvent.mockReset();
    updateEvent.mockReset();
    deleteEvent.mockReset();
    cancelEvent.mockReset();
    cancelYouthService.mockReset();
    updateAssignment.mockReset();
    updateSlotUniform.mockReset();
    finalizeMonth.mockReset();
    getUniforms.mockReset();
    createEventGroup.mockReset();
    listEventGroups.mockReset();
    updateEventGroupTitle.mockReset();
    addEventGroupTurno.mockReset();
    updateEventGroupTurno.mockReset();
    deleteEventGroupTurno.mockReset();
    cancelEventGroup.mockReset();
    deleteEventGroup.mockReset();
    listVerses.mockReset();
    addVerse.mockReset();
    deleteVerse.mockReset();

    getUniforms.mockResolvedValue([
      { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF", active: true },
      { id: "u-2", name: "Uniforme B", colorHex: "#16A34A", active: true },
    ]);
    // Default sin eventos agrupados ni versículos: los tests que no ejercitan
    // esos flujos no deben ver estados de carga/error inesperados.
    listEventGroups.mockResolvedValue({ groups: [] });
    listVerses.mockResolvedValue({ verses: [] });
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

  it("el botón «Finalizar mes» está deshabilitado si algún turno no tiene uniforme asignado (ajustado 2026-08-22)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue({
      slots: [fixedSlot(), fixedSlot2(), { ...extraordinarySlot(), uniform: null }],
      balance: fullSchedule().balance,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Finalizar mes" })).toBeDisabled();
    expect(screen.getByText("Hay 1 turno sin uniforme asignado.")).toBeInTheDocument();
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

  it("«Eliminar mes» está habilitado en un mes DRAFT, pide confirmación y llama a deleteMonth", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    deleteMonth.mockResolvedValueOnce({ deleted: true });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    const deleteButton = screen.getByRole("button", { name: "Eliminar mes" });
    expect(deleteButton).not.toBeDisabled();

    await user.click(deleteButton);
    expect(screen.getByRole("heading", { name: "Eliminar el mes" })).toBeInTheDocument();
    expect(deleteMonth).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar mes" }));

    await waitFor(() => expect(deleteMonth).toHaveBeenCalledWith("month-1"));
    await waitFor(() => expect(screen.getByText("Se eliminó el mes.")).toBeInTheDocument());
  });

  it("«Eliminar mes» está deshabilitado en un mes FINALIZED que ya pasó, con el motivo visible", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8)); // 8 de setiembre de 2026: sampleMonth() (agosto 2026) ya pasó.

    getMonths.mockResolvedValue({
      data: [sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-01T00:00:00.000Z" })],
    });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Eliminar mes" })).toBeDisabled();
  });

  it("mapea MES_PASADO a un mensaje claro (eliminar mes)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    deleteMonth.mockRejectedValueOnce(
      new ApiError("Conflicto.", { status: 409, details: { code: "MES_PASADO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Eliminar mes" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar mes" }));

    await waitFor(() =>
      expect(screen.getByText("Este mes ya pasó, no se puede eliminar.")).toBeInTheDocument(),
    );
  });

  // Fase 4c (docs/architecture/phase4c-post-publish-edits-contract.md §0/§8),
  // ampliada 2026-08-25: un mes FINALIZED "actual o futuro" relaja agregar/
  // cancelar/eliminar evento (o el Servicio de jóvenes), el uniforme por
  // turno, Y AHORA TAMBIÉN bloquear/reasignar y "Editar evento" completo.
  // Solo generar/regenerar el horario y (re)sortear equipos siguen exigiendo
  // `DRAFT` sin excepción de fecha.
  it("con un mes finalizado actual, agregar/cancelar/eliminar evento, el uniforme, bloquear/reasignar y editar evento completo siguen habilitados, pero regenerar horario sigue deshabilitado", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 8)); // 8 de agosto de 2026: mismo mes/año que sampleMonth().

    getMonths.mockResolvedValue({
      data: [sampleMonth({ status: "FINALIZED", finalizedAt: "2026-08-01T00:00:00.000Z" })],
    });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    // Grupo ampliado 2026-08-25: habilitado en un mes finalizado actual/futuro.
    expect(screen.getByRole("button", { name: "Agregar evento extraordinario" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar evento" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar evento" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar Servicio de jóvenes" })).not.toBeDisabled();
    screen.getAllByLabelText("Uniforme de este turno").forEach((select) => expect(select).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Editar evento" })).not.toBeDisabled();
    screen.getAllByRole("button", { name: "Bloquear" }).forEach((button) => expect(button).not.toBeDisabled());
    screen.getAllByLabelText("Equipo asignado a este turno").forEach((select) => expect(select).not.toBeDisabled());

    // Único grupo que sigue exigiendo DRAFT sin excepción.
    expect(screen.getByRole("button", { name: "Regenerar horario" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Cancelar Servicio de jóvenes" })).toBeDisabled();
    screen.getAllByLabelText("Uniforme de este turno").forEach((select) => expect(select).toBeDisabled());
    expect(screen.getByRole("button", { name: "Regenerar horario" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Editar evento" })).toBeDisabled();
    screen.getAllByRole("button", { name: "Bloquear" }).forEach((button) => expect(button).toBeDisabled());
    screen.getAllByLabelText("Equipo asignado a este turno").forEach((select) => expect(select).toBeDisabled());
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

  // Nuevo (2026-08-25): cancelar el Servicio de jóvenes, distinto de cancelar
  // un evento extraordinario — reutiliza el mismo `cancelTarget`/`ConfirmDialog`,
  // pero llama a `cancelYouthService(monthId)` en vez de `cancelEvent(eventId)`.
  it("cancela el Servicio de jóvenes tras confirmar (endpoint y textos distintos de «Cancelar evento»)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValueOnce(fullSchedule()).mockResolvedValueOnce({
      slots: [fixedSlot(), fixedSlot2(), extraordinarySlot(), cancelledYouthSlot()],
      balance: fullSchedule().balance,
    });
    cancelYouthService.mockResolvedValueOnce({ slot: cancelledYouthSlot() });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancelar Servicio de jóvenes" }));
    expect(screen.getByRole("heading", { name: "Cancelar Servicio de jóvenes" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, cancelar Servicio de jóvenes" }));

    await waitFor(() => expect(cancelYouthService).toHaveBeenCalledWith("month-1"));
    expect(cancelEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Se canceló el Servicio de jóvenes.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Cancelado")).toBeInTheDocument());
  });

  it("no ofrece «Cancelar Servicio de jóvenes» si ya está cancelado", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue({
      slots: [fixedSlot(), fixedSlot2(), extraordinarySlot(), cancelledYouthSlot()],
      balance: fullSchedule().balance,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Cancelado")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Cancelar Servicio de jóvenes" })).not.toBeInTheDocument();
    // A diferencia de un evento extraordinario cancelado, el Servicio de
    // jóvenes cancelado no ofrece "Eliminar evento" (eso vive en «Equipos»).
    expect(screen.queryAllByRole("button", { name: "Eliminar evento" })).toHaveLength(1);
  });

  it("mapea SERVICIO_JOVENES_YA_CANCELADO a un mensaje claro (cancelar Servicio de jóvenes)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue(regularTeams());
    getMonthSchedule.mockResolvedValue(fullSchedule());
    cancelYouthService.mockRejectedValueOnce(
      new ApiError("Conflicto.", { status: 409, details: { code: "SERVICIO_JOVENES_YA_CANCELADO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cancelar Servicio de jóvenes" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Sí, cancelar Servicio de jóvenes" }));

    await waitFor(() =>
      expect(screen.getByText("El Servicio de jóvenes ya está cancelado.")).toBeInTheDocument(),
    );
  });

  // Parte 1 (plan wise-noodling-hickey.md): teamsNeeded libre de 1 hasta la
  // cantidad de equipos REGULAR del mes, en vez de fijo en 1/2.
  describe("teamsNeeded libre (Parte 1)", () => {
    it("el formulario de evento ofrece tantas opciones de «Cantidad de equipos» como equipos regulares tiene el mes", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(threeRegularTeams());
      getMonthSchedule.mockResolvedValue(threeTeamSchedule());
      const user = userEvent.setup();
      renderPage();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Agregar evento extraordinario" })).toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "Agregar evento extraordinario" }));
      const dialog = screen.getByRole("dialog");

      const select = within(dialog).getByLabelText("Cantidad de equipos");
      const optionLabels = within(select)
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(optionLabels).toEqual(["1 equipo", "2 equipos", "3 equipos"]);
    });

    it("mapea TEAMSNEEDED_EXCEDE_EQUIPOS a un mensaje claro al crear un evento", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      createEvent.mockRejectedValueOnce(
        new ApiError("Conflicto.", {
          status: 400,
          details: { code: "TEAMSNEEDED_EXCEDE_EQUIPOS", teamsNeeded: 3, regularTeamCount: 2 },
        }),
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
        expect(screen.getByText("No podés pedir más equipos de los que tiene el mes.")).toBeInTheDocument(),
      );
    });
  });

  // Parte 2 (plan wise-noodling-hickey.md): eventos agrupados (Congreso,
  // etc.), con 2+ fechas y 1+ turnos por fecha, equipos elegidos a mano.
  describe("eventos agrupados / Congreso (Parte 2)", () => {
    it("un turno de evento agrupado muestra su badge de grupo y no ofrece las acciones de evento suelto", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue({
        slots: [fixedSlot(), fixedSlot2(), groupedSlot()],
        balance: fullSchedule().balance,
      });
      renderPage();

      // El título del turno y el badge del grupo muestran el mismo texto: 2 apariciones.
      await waitFor(() => expect(screen.getAllByText("Congreso de danza")).toHaveLength(2));
      expect(screen.queryByRole("button", { name: "Editar evento" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancelar evento" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Eliminar evento" })).not.toBeInTheDocument();
    });

    it("lista los eventos agrupados existentes con sus turnos", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      expect(await within(groupsSection).findByRole("heading", { name: "Congreso de danza" })).toBeInTheDocument();
      expect(within(groupsSection).getByText("Equipo 1, Equipo 2")).toBeInTheDocument();
    });

    it("«Crear evento agrupado» está deshabilitado hasta tener al menos 2 fechas válidas", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(within(groupsSection).getByRole("button", { name: "Nuevo evento agrupado" }));

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Crear evento agrupado" })).toBeDisabled();

      fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: "Congreso" } });
      // Solo se completa la primera fecha: sigue deshabilitado (falta la segunda).
      const dateGroups = within(dialog).getAllByRole("group", { name: /^Fecha \d$/ });
      fireEvent.change(within(dateGroups[0]).getByLabelText(/^Fecha/), { target: { value: "2026-08-12" } });
      fireEvent.change(within(dateGroups[0]).getByLabelText(/^Hora/), { target: { value: "09:00" } });
      await user.click(within(dateGroups[0]).getByLabelText("Equipo 1"));

      expect(within(dialog).getByRole("button", { name: "Crear evento agrupado" })).toBeDisabled();
      expect(createEventGroup).not.toHaveBeenCalled();
    });

    it("crea un evento agrupado con al menos 2 fechas distintas", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      createEventGroup.mockResolvedValueOnce({ group: sampleEventGroup() });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(within(groupsSection).getByRole("button", { name: "Nuevo evento agrupado" }));

      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: "Congreso de danza" } });

      const dateGroups = within(dialog).getAllByRole("group", { name: /^Fecha \d$/ });
      expect(dateGroups).toHaveLength(2);

      fireEvent.change(within(dateGroups[0]).getByLabelText(/^Fecha/), { target: { value: "2026-08-12" } });
      fireEvent.change(within(dateGroups[0]).getByLabelText(/^Hora/), { target: { value: "09:00" } });
      await user.click(within(dateGroups[0]).getByLabelText("Equipo 1"));

      fireEvent.change(within(dateGroups[1]).getByLabelText(/^Fecha/), { target: { value: "2026-08-13" } });
      fireEvent.change(within(dateGroups[1]).getByLabelText(/^Hora/), { target: { value: "09:00" } });
      await user.click(within(dateGroups[1]).getByLabelText("Equipo 2"));

      const submitButton = within(dialog).getByRole("button", { name: "Crear evento agrupado" });
      expect(submitButton).not.toBeDisabled();
      await user.click(submitButton);

      await waitFor(() =>
        expect(createEventGroup).toHaveBeenCalledWith("month-1", {
          title: "Congreso de danza",
          turnos: [
            { date: "2026-08-12", startTime: "09:00", teamIds: ["team-1"] },
            { date: "2026-08-13", startTime: "09:00", teamIds: ["team-2"] },
          ],
        }),
      );
      await waitFor(() => expect(screen.getByText("Se creó el evento agrupado.")).toBeInTheDocument());
    });

    it("mapea CONGRESO_MINIMO_DOS_FECHAS a un mensaje claro", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      createEventGroup.mockRejectedValueOnce(
        new ApiError("Conflicto.", { status: 400, details: { code: "CONGRESO_MINIMO_DOS_FECHAS" } }),
      );
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(within(groupsSection).getByRole("button", { name: "Nuevo evento agrupado" }));

      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: "Congreso" } });
      const dateGroups = within(dialog).getAllByRole("group", { name: /^Fecha \d$/ });
      fireEvent.change(within(dateGroups[0]).getByLabelText(/^Fecha/), { target: { value: "2026-08-12" } });
      fireEvent.change(within(dateGroups[0]).getByLabelText(/^Hora/), { target: { value: "09:00" } });
      await user.click(within(dateGroups[0]).getByLabelText("Equipo 1"));
      fireEvent.change(within(dateGroups[1]).getByLabelText(/^Fecha/), { target: { value: "2026-08-13" } });
      fireEvent.change(within(dateGroups[1]).getByLabelText(/^Hora/), { target: { value: "09:00" } });
      await user.click(within(dateGroups[1]).getByLabelText("Equipo 2"));

      await user.click(within(dialog).getByRole("button", { name: "Crear evento agrupado" }));

      await waitFor(() =>
        expect(
          screen.getByText("Un evento agrupado necesita al menos 2 fechas distintas."),
        ).toBeInTheDocument(),
      );
    });

    it("renombra un evento agrupado existente", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      updateEventGroupTitle.mockResolvedValueOnce({ group: { ...sampleEventGroup(), title: "Congreso 2026" } });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(await within(groupsSection).findByRole("button", { name: "Renombrar" }));

      const dialog = screen.getByRole("dialog");
      const titleInput = within(dialog).getByLabelText(/^Título/);
      fireEvent.change(titleInput, { target: { value: "Congreso 2026" } });
      await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => expect(updateEventGroupTitle).toHaveBeenCalledWith("group-1", "Congreso 2026"));
      await waitFor(() => expect(screen.getByText("Se renombró el evento agrupado.")).toBeInTheDocument());
    });

    it("agrega un turno a un evento agrupado ya existente", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      addEventGroupTurno.mockResolvedValueOnce({
        slot: groupedSlot({ id: "slot-congreso-3", date: "2026-08-14" }),
      });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(await within(groupsSection).findByRole("button", { name: "Agregar turno" }));

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("heading", { name: "Agregar turno" })).toBeInTheDocument();
      fireEvent.change(within(dialog).getByLabelText(/^Fecha/), { target: { value: "2026-08-14" } });
      fireEvent.change(within(dialog).getByLabelText(/^Hora/), { target: { value: "10:00" } });
      await user.click(within(dialog).getByLabelText("Equipo 1"));
      await user.click(within(dialog).getByRole("button", { name: "Agregar turno" }));

      await waitFor(() =>
        expect(addEventGroupTurno).toHaveBeenCalledWith("group-1", {
          date: "2026-08-14",
          startTime: "10:00",
          teamIds: ["team-1"],
        }),
      );
      await waitFor(() =>
        expect(screen.getByText("Se agregó el turno al evento agrupado.")).toBeInTheDocument(),
      );
    });

    it("edita un turno de un evento agrupado existente (precargado con sus datos actuales)", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      updateEventGroupTurno.mockResolvedValueOnce({ slot: groupedSlot() });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      const editButtons = await within(groupsSection).findAllByRole("button", { name: "Editar" });
      await user.click(editButtons[0]);

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText(/^Fecha/)).toHaveValue("2026-08-12");
      fireEvent.change(within(dialog).getByLabelText(/^Hora/), { target: { value: "10:30" } });
      await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() =>
        expect(updateEventGroupTurno).toHaveBeenCalledWith("slot-congreso-1", {
          date: "2026-08-12",
          startTime: "10:30",
          teamIds: ["team-1", "team-2"],
          uniformId: null,
        }),
      );
    });

    it("elimina un turno de un evento agrupado tras confirmar", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      deleteEventGroupTurno.mockResolvedValueOnce({ deleted: true });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      const deleteButtons = await within(groupsSection).findAllByRole("button", { name: "Eliminar" });
      await user.click(deleteButtons[0]);

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("heading", { name: "Eliminar turno" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar" }));

      await waitFor(() => expect(deleteEventGroupTurno).toHaveBeenCalledWith("slot-congreso-1"));
    });

    it("cancela un evento agrupado completo tras confirmar", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      cancelEventGroup.mockResolvedValueOnce({ group: sampleEventGroup() });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(await within(groupsSection).findByRole("button", { name: "Cancelar completo" }));

      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Sí, cancelar evento agrupado" }));

      await waitFor(() => expect(cancelEventGroup).toHaveBeenCalledWith("group-1"));
      await waitFor(() => expect(screen.getByText("Se canceló el evento agrupado.")).toBeInTheDocument());
    });

    it("elimina un evento agrupado completo tras confirmar", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listEventGroups.mockResolvedValue({ groups: [sampleEventGroup()] });
      deleteEventGroup.mockResolvedValueOnce({ deleted: true });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const groupsSection = screen.getByRole("region", { name: "Eventos agrupados" });
      await user.click(await within(groupsSection).findByRole("button", { name: "Eliminar completo" }));

      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar" }));

      await waitFor(() => expect(deleteEventGroup).toHaveBeenCalledWith("group-1"));
      await waitFor(() => expect(screen.getByText("Se eliminó el evento agrupado.")).toBeInTheDocument());
    });
  });

  // Parte 4 (plan wise-noodling-hickey.md): Versículo del mes (RVR1960).
  describe("versículo del mes (Parte 4)", () => {
    it("agrega un versículo del mes y lo muestra en la lista", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listVerses
        .mockResolvedValueOnce({ verses: [] })
        .mockResolvedValueOnce({
          verses: [
            {
              id: "v-1",
              book: "Juan",
              chapter: 3,
              verses: "16",
              version: "RVR1960",
              text: "Porque de tal manera amó Dios al mundo...",
              reference: "Juan 3:16 (RVR1960)",
            },
          ],
        });
      addVerse.mockResolvedValueOnce({ verse: { id: "v-1" } });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const versesSection = screen.getByRole("region", { name: "Versículo del mes" });

      fireEvent.change(within(versesSection).getByLabelText(/^Libro/), { target: { value: "Juan" } });
      fireEvent.change(within(versesSection).getByLabelText(/^Capítulo/), { target: { value: "3" } });
      fireEvent.change(within(versesSection).getByLabelText(/^Versículos/), { target: { value: "16" } });
      await user.click(within(versesSection).getByRole("button", { name: "Buscar y agregar" }));

      await waitFor(() =>
        expect(addVerse).toHaveBeenCalledWith("month-1", { book: "Juan", chapter: 3, verses: "16" }),
      );
      await waitFor(() => expect(screen.getByText("Juan 3:16 (RVR1960)")).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText("Se agregó el versículo del mes.")).toBeInTheDocument());
    });

    it("mapea VERSICULO_NO_ENCONTRADO a un mensaje claro", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      addVerse.mockRejectedValueOnce(
        new ApiError("No encontrado.", { status: 404, details: { code: "VERSICULO_NO_ENCONTRADO" } }),
      );
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Vigilia")).toBeInTheDocument());
      const versesSection = screen.getByRole("region", { name: "Versículo del mes" });

      fireEvent.change(within(versesSection).getByLabelText(/^Libro/), { target: { value: "Xyz" } });
      fireEvent.change(within(versesSection).getByLabelText(/^Capítulo/), { target: { value: "999" } });
      fireEvent.change(within(versesSection).getByLabelText(/^Versículos/), { target: { value: "1" } });
      await user.click(within(versesSection).getByRole("button", { name: "Buscar y agregar" }));

      await waitFor(() =>
        expect(
          screen.getByText("No encontramos esa referencia bíblica. Revisa el libro, el capítulo y los versículos."),
        ).toBeInTheDocument(),
      );
    });

    it("elimina un versículo tras confirmar", async () => {
      getMonths.mockResolvedValue({ data: [sampleMonth()] });
      getMonthTeams.mockResolvedValue(regularTeams());
      getMonthSchedule.mockResolvedValue(fullSchedule());
      listVerses.mockResolvedValue({
        verses: [
          {
            id: "v-1",
            book: "Juan",
            chapter: 3,
            verses: "16",
            version: "RVR1960",
            text: "Porque de tal manera amó Dios al mundo...",
            reference: "Juan 3:16 (RVR1960)",
          },
        ],
      });
      deleteVerse.mockResolvedValueOnce({ deleted: true });
      const user = userEvent.setup();
      renderPage();

      await waitFor(() => expect(screen.getByText("Juan 3:16 (RVR1960)")).toBeInTheDocument());
      const versesSection = screen.getByRole("region", { name: "Versículo del mes" });
      await user.click(within(versesSection).getByRole("button", { name: "Eliminar" }));

      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Sí, eliminar" }));

      await waitFor(() => expect(deleteVerse).toHaveBeenCalledWith("v-1"));
      await waitFor(() => expect(screen.getByText("Se eliminó el versículo.")).toBeInTheDocument());
    });
  });
});
