import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TeamGenerator } from "../pages/TeamGenerator.jsx";
import { ToastViewport } from "../components/ui/Toast.jsx";

// Se mockea `api/months.js` y `api/people.js` completos para no depender de
// un servidor real y poder controlar cada escenario (mes vacío, sorteo,
// re-sorteo, pool insuficiente, edición manual, equipo de jóvenes) de forma
// determinista. Ver docs/architecture/phase3-teams-contract.md (incl. §9,
// equipo de jóvenes) para el contrato exacto.
vi.mock("../api/months.js", () => ({
  getMonths: vi.fn(),
  createMonth: vi.fn(),
  getMonth: vi.fn(),
  getMonthTeams: vi.fn(),
  generateTeams: vi.fn(),
  updateTeam: vi.fn(),
}));

vi.mock("../api/people.js", () => ({
  getPeople: vi.fn(),
}));

import { createMonth, generateTeams, getMonths, getMonthTeams, updateTeam } from "../api/months.js";
import { getPeople } from "../api/people.js";
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

function sampleTeams() {
  return {
    teams: [
      {
        id: "team-1",
        label: "Equipo 1",
        orderIndex: 1,
        teamType: "REGULAR",
        members: [
          { id: "tm-1", personId: "p-1", fullName: "Ana Gómez", role: "LEADER", manualOverride: false },
          { id: "tm-2", personId: "p-2", fullName: "Beto Ruiz", role: "COLLABORATOR", manualOverride: false },
        ],
      },
      {
        id: "team-2",
        label: "Equipo 2",
        orderIndex: 2,
        teamType: "REGULAR",
        members: [
          { id: "tm-3", personId: "p-3", fullName: "Carla Díaz", role: "LEADER", manualOverride: false },
        ],
      },
    ],
  };
}

function sampleYouthTeam() {
  return {
    id: "team-youth",
    label: "Servicio de jóvenes",
    orderIndex: 3,
    teamType: "YOUTH",
    members: [
      { id: "tm-y1", personId: "p-5", fullName: "Elena Cruz", role: "LEADER", manualOverride: true },
      { id: "tm-y2", personId: "p-6", fullName: "Franco Ibarra", role: "COLLABORATOR", manualOverride: false },
    ],
  };
}

function samplePeoplePage() {
  return {
    data: [
      { id: "p-1", fullName: "Ana Gómez", documentId: null, category: "INSTRUCTOR", isJoven: false, active: true, notes: null },
      { id: "p-2", fullName: "Beto Ruiz", documentId: null, category: "MINISTRO", isJoven: false, active: true, notes: null },
      { id: "p-3", fullName: "Carla Díaz", documentId: null, category: "INSTRUCTOR", isJoven: false, active: true, notes: null },
      { id: "p-4", fullName: "Diego Lara", documentId: null, category: "MINISTRO", isJoven: false, active: true, notes: null },
    ],
    pagination: { page: 1, pageSize: 100, total: 4, totalPages: 1 },
  };
}

function youthPeoplePage() {
  return {
    data: [
      { id: "p-5", fullName: "Elena Cruz", documentId: null, category: "MINISTRO", isJoven: true, active: true, notes: null },
      { id: "p-6", fullName: "Franco Ibarra", documentId: null, category: "INSTRUCTOR", isJoven: true, active: true, notes: null },
    ],
    pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
  };
}

// Mock genérico de `getPeople` que responde según el filtro pedido: pool de
// jóvenes cuando se pide `isJoven: true` (selector de líder del equipo de
// jóvenes), padrón activo general en cualquier otro caso (edición manual de
// roster). Evita depender del orden exacto de llamadas entre ambos flujos.
function mockGetPeopleByFilter() {
  getPeople.mockImplementation((params) =>
    Promise.resolve(params && params.isJoven ? youthPeoplePage() : samplePeoplePage()),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TeamGenerator />
      <ToastViewport />
    </MemoryRouter>,
  );
}

describe("TeamGenerator", () => {
  beforeEach(() => {
    getMonths.mockReset();
    createMonth.mockReset();
    getMonthTeams.mockReset();
    generateTeams.mockReset();
    updateTeam.mockReset();
    getPeople.mockReset();
  });

  it("muestra un estado vacío entendible y permite crear el primer mes", async () => {
    getMonths.mockResolvedValueOnce({ data: [] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Todavía no hay ningún mes creado")).toBeInTheDocument());

    getMonths.mockResolvedValueOnce({ data: [sampleMonth()] });
    createMonth.mockResolvedValueOnce(sampleMonth());
    getMonthTeams.mockResolvedValue({ teams: [] });

    await user.click(screen.getByRole("button", { name: "Crear mes" }));
    expect(screen.getByRole("heading", { name: "Crear mes nuevo" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Año/), { target: { value: "2026" } });
    fireEvent.change(within(dialog).getByLabelText(/^Cantidad de equipos/), { target: { value: "2" } });

    await user.click(within(dialog).getByRole("button", { name: "Crear mes" }));

    await waitFor(() =>
      expect(createMonth).toHaveBeenCalledWith(expect.objectContaining({ year: 2026, teamCount: 2 })),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Sortear equipos" })).toBeInTheDocument());
  });

  it("muestra el 409 MES_YA_EXISTE de forma clara con acceso directo al mes existente", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValue({ teams: [] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: "Sortear equipos" })).toBeInTheDocument());

    createMonth.mockRejectedValueOnce(
      new ApiError("Ya existe un mes creado para ese año/mes.", {
        status: 409,
        details: { code: "MES_YA_EXISTE", monthCycleId: "month-1" },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Crear mes nuevo" }));
    await user.click(screen.getByRole("button", { name: "Crear mes" }));

    await waitFor(() =>
      expect(screen.getByText("Ya existe un mes creado para ese año y mes.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Ver ese mes" })).toBeInTheDocument();
  });

  it("el diálogo de sorteo trae el equipo de jóvenes habilitado por defecto y exige elegir líder antes de confirmar", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [] });
    mockGetPeopleByFilter();
    generateTeams.mockResolvedValueOnce({
      teams: [...sampleTeams().teams, sampleYouthTeam()],
      warnings: [],
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene equipos sorteados")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Sortear equipos" }));
    expect(screen.getByRole("heading", { name: "Sortear los equipos del mes" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    const youthCheckbox = within(dialog).getByRole("checkbox", { name: "Habilitar equipo de jóvenes" });
    expect(youthCheckbox).toBeChecked();

    // Sin elegir líder, no se puede confirmar.
    const confirmButton = within(dialog).getByRole("button", { name: "Confirmar sorteo" });
    expect(confirmButton).toBeDisabled();

    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Elena Cruz" })).toBeInTheDocument());

    await user.selectOptions(
      within(dialog).getByLabelText(/^Líder del equipo de jóvenes/),
      "p-5",
    );
    expect(confirmButton).toBeEnabled();

    // Cambia la cantidad del default 10 a 5.
    fireEvent.change(within(dialog).getByLabelText(/^Cantidad de personas/), { target: { value: "5" } });

    await user.click(confirmButton);

    await waitFor(() =>
      expect(generateTeams).toHaveBeenCalledWith("month-1", {
        youthTeam: { enabled: true, size: 5, leaderPersonId: "p-5" },
      }),
    );
    await waitFor(() => expect(screen.getByText("Servicio de jóvenes")).toBeInTheDocument());
  });

  it("al desmarcar el equipo de jóvenes no pide líder ni tamaño y lo manda como deshabilitado", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [] });
    mockGetPeopleByFilter();
    generateTeams.mockResolvedValueOnce({ teams: sampleTeams().teams, warnings: [] });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene equipos sorteados")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Sortear equipos" }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("checkbox", { name: "Habilitar equipo de jóvenes" }));
    expect(within(dialog).queryByLabelText(/^Líder del equipo de jóvenes/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Cantidad de personas/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Confirmar sorteo" }));

    await waitFor(() =>
      expect(generateTeams).toHaveBeenCalledWith("month-1", { youthTeam: { enabled: false } }),
    );
  });

  it("pide confirmación antes de re-sortear equipos ya existentes y muestra los warnings devueltos (incluido el de jóvenes)", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce(sampleTeams());
    mockGetPeopleByFilter();
    generateTeams.mockResolvedValueOnce({
      teams: sampleTeams().teams,
      warnings: [
        { code: "LIDER_REPETIDO_POSIBLE", message: "Es posible que se repita algún líder." },
        { code: "JOVENES_REPETIDOS_POSIBLE", message: "Es posible que se repita alguien del equipo de jóvenes." },
      ],
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Equipo 1")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Re-sortear equipos" }));

    expect(screen.getByRole("heading", { name: "Volver a sortear los equipos" })).toBeInTheDocument();
    expect(generateTeams).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Elena Cruz" })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText(/^Líder del equipo de jóvenes/), "p-5");
    await user.click(within(dialog).getByRole("button", { name: "Sí, volver a sortear" }));

    await waitFor(() =>
      expect(generateTeams).toHaveBeenCalledWith("month-1", {
        youthTeam: { enabled: true, size: 10, leaderPersonId: "p-5" },
      }),
    );
    await waitFor(() => expect(screen.getByText("Es posible que se repita algún líder.")).toBeInTheDocument());
    expect(screen.getByText("Es posible que se repita alguien del equipo de jóvenes.")).toBeInTheDocument();
  });

  it("muestra un mensaje claro y accionable cuando el pool de instructores es insuficiente", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [] });
    mockGetPeopleByFilter();
    generateTeams.mockRejectedValueOnce(
      new ApiError("No hay suficientes instructores activos para formar los equipos.", {
        status: 409,
        details: { code: "POOL_INSTRUCTOR_INSUFICIENTE", available: 1, needed: 2 },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene equipos sorteados")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Sortear equipos" }));
    const dialog = screen.getByRole("dialog");
    // Se desmarca el equipo de jóvenes para aislar el error del pool de instructores.
    await user.click(within(dialog).getByRole("checkbox", { name: "Habilitar equipo de jóvenes" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirmar sorteo" }));

    await waitFor(() => expect(screen.getByText(/solo hay 1 disponible/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Ir a Personas" })).toBeInTheDocument();
  });

  it("muestra POOL_JOVENES_INSUFICIENTE con un mensaje entendible", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [] });
    mockGetPeopleByFilter();
    generateTeams.mockRejectedValueOnce(
      new ApiError("No hay suficientes personas para el equipo de jóvenes.", {
        status: 409,
        details: { code: "POOL_JOVENES_INSUFICIENTE", available: 2, needed: 10 },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene equipos sorteados")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Sortear equipos" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Elena Cruz" })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText(/^Líder del equipo de jóvenes/), "p-5");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar sorteo" }));

    await waitFor(() =>
      expect(
        screen.getByText(/No hay suficientes personas marcadas como «Joven».*hay 2, se necesitan 10/),
      ).toBeInTheDocument(),
    );
  });

  it("muestra LIDER_JOVENES_INVALIDO con un mensaje entendible", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [] });
    mockGetPeopleByFilter();
    generateTeams.mockRejectedValueOnce(
      new ApiError("Líder de jóvenes inválido.", {
        status: 400,
        details: { code: "LIDER_JOVENES_INVALIDO" },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene equipos sorteados")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Sortear equipos" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Elena Cruz" })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText(/^Líder del equipo de jóvenes/), "p-5");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar sorteo" }));

    await waitFor(() =>
      expect(
        screen.getByText(/La persona elegida como líder del equipo de jóvenes no es válida/),
      ).toBeInTheDocument(),
    );
  });

  it("muestra SORTEO_EN_CURSO con un mensaje entendible", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [] });
    mockGetPeopleByFilter();
    generateTeams.mockRejectedValueOnce(
      new ApiError("Ya se está generando el sorteo de este mes en otra pestaña o solicitud; esperá a que termine y volvé a intentar.", {
        status: 409,
        details: { code: "SORTEO_EN_CURSO" },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Este mes todavía no tiene equipos sorteados")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Sortear equipos" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Habilitar equipo de jóvenes" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirmar sorteo" }));

    await waitFor(() =>
      expect(screen.getByText(/Ya se está generando el sorteo de este mes/)).toBeInTheDocument(),
    );
  });

  it("permite editar manualmente un equipo regular: quitar a alguien y agregar a otra persona", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce(sampleTeams());
    getPeople.mockResolvedValueOnce(samplePeoplePage());
    updateTeam.mockResolvedValueOnce({
      team: {
        id: "team-1",
        label: "Equipo 1",
        orderIndex: 1,
        teamType: "REGULAR",
        members: [
          { id: "tm-1", personId: "p-1", fullName: "Ana Gómez", role: "LEADER", manualOverride: false },
          { id: "tm-4", personId: "p-4", fullName: "Diego Lara", role: "COLLABORATOR", manualOverride: false },
        ],
      },
    });
    getMonthTeams.mockResolvedValueOnce({
      teams: [
        {
          id: "team-1",
          label: "Equipo 1",
          orderIndex: 1,
          teamType: "REGULAR",
          members: [
            { id: "tm-1", personId: "p-1", fullName: "Ana Gómez", role: "LEADER", manualOverride: false },
            { id: "tm-4", personId: "p-4", fullName: "Diego Lara", role: "COLLABORATOR", manualOverride: false },
          ],
        },
        sampleTeams().teams[1],
      ],
    });

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Equipo 1")).toBeInTheDocument());

    const teamOneCard = screen.getByText("Equipo 1").closest("article");
    await user.click(within(teamOneCard).getByRole("button", { name: "Editar integrantes" }));

    await waitFor(() => expect(getPeople).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Editar Equipo 1" })).toBeInTheDocument();

    // El equipo es REGULAR: el selector de rol sigue ofreciendo las 3 opciones.
    const roleSelect = screen.getAllByLabelText(/Rol de/)[0];
    expect(within(roleSelect).getByRole("option", { name: "Apoyo" })).toBeInTheDocument();

    // Quitar a Beto Ruiz (ministro) del equipo.
    await user.click(screen.getByRole("button", { name: "Quitar a Beto Ruiz del equipo" }));

    // Agregar a Diego Lara.
    await user.selectOptions(screen.getByLabelText("Agregar integrante"), "p-4");
    await user.click(screen.getByRole("button", { name: "Agregar al equipo" }));

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(updateTeam).toHaveBeenCalledWith("team-1", {
        members: [
          { personId: "p-1", role: "LEADER" },
          { personId: "p-4", role: "COLLABORATOR" },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Editar Equipo 1" })).not.toBeInTheDocument());
  });

  it("no deja guardar un equipo sin líder y explica por qué", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce(sampleTeams());
    getPeople.mockResolvedValueOnce(samplePeoplePage());

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Equipo 1")).toBeInTheDocument());
    const teamOneCard = screen.getByText("Equipo 1").closest("article");
    await user.click(within(teamOneCard).getByRole("button", { name: "Editar integrantes" }));

    await waitFor(() => expect(getPeople).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Quitar a Ana Gómez del equipo" }));

    expect(
      screen.getByText("Este equipo necesita exactamente un líder. Marca a alguien como «Líder» antes de guardar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(updateTeam).not.toHaveBeenCalled();
  });

  it("renderiza el equipo de jóvenes devuelto por la API y, al editarlo, el selector de rol no ofrece «Apoyo»", async () => {
    getMonths.mockResolvedValue({ data: [sampleMonth()] });
    getMonthTeams.mockResolvedValueOnce({ teams: [...sampleTeams().teams, sampleYouthTeam()] });
    getPeople.mockResolvedValueOnce(samplePeoplePage());

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Servicio de jóvenes")).toBeInTheDocument());
    expect(screen.getByText("Elena Cruz")).toBeInTheDocument();

    const youthCard = screen.getByText("Servicio de jóvenes").closest("article");
    await user.click(within(youthCard).getByRole("button", { name: "Editar integrantes" }));

    await waitFor(() => expect(getPeople).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Editar Servicio de jóvenes" })).toBeInTheDocument();

    const roleSelects = screen.getAllByLabelText(/Rol de/);
    roleSelects.forEach((select) => {
      expect(within(select).queryByRole("option", { name: "Apoyo" })).not.toBeInTheDocument();
    });
  });
});
