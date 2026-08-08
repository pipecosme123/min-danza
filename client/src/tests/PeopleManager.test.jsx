import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeopleManager } from "../pages/PeopleManager.jsx";

// `PeopleManager` no usa hooks de react-router (no Link/useNavigate), así
// que se puede renderizar de forma aislada. Se mockea `api/people.js`
// completo para no depender de un servidor real (el backend se construye en
// paralelo, ver docs/architecture/phase2-people-contract.md) y para poder
// controlar cada escenario (listado, vacío, error) de forma determinista.
vi.mock("../api/people.js", () => ({
  getPeople: vi.fn(),
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
  deactivatePerson: vi.fn(),
  importPeople: vi.fn(),
}));

import { getPeople, createPerson, updatePerson } from "../api/people.js";

function samplePage(overrides = {}) {
  return {
    data: [
      {
        id: "1",
        fullName: "Ana Gómez",
        documentId: "1234567",
        category: "INSTRUCTOR",
        active: true,
        notes: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    ...overrides,
  };
}

describe("PeopleManager", () => {
  beforeEach(() => {
    getPeople.mockReset();
    createPerson.mockReset();
    updatePerson.mockReset();
  });

  it("carga y muestra el listado de personas al montar, pidiendo solo activas por defecto", async () => {
    getPeople.mockResolvedValueOnce(samplePage());
    render(<PeopleManager />);

    expect(screen.getByRole("heading", { name: "Personas" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    expect(getPeople).toHaveBeenCalledWith(expect.objectContaining({ active: true, page: 1 }));
  });

  it("traduce category=INSTRUCTOR/MINISTRO a las etiquetas «Instructor»/«Ministro» y no deja rastro del vocabulario viejo", async () => {
    getPeople.mockResolvedValueOnce(
      samplePage({
        data: [
          { id: "1", fullName: "Ana Gómez", documentId: "1234567", category: "INSTRUCTOR", active: true, notes: null },
          { id: "2", fullName: "Beto Ruiz", documentId: "7654321", category: "MINISTRO", active: true, notes: null },
        ],
        pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      }),
    );
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Instructor")).toBeInTheDocument();
    expect(table.getByText("Ministro")).toBeInTheDocument();
    expect(screen.queryByText(/colaborador/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/elegible/i)).not.toBeInTheDocument();

    // Filtro de categoría: debe ofrecer los valores nuevos, nunca los viejos.
    const filterSelect = screen.getByLabelText("Categoría");
    const optionLabels = Array.from(filterSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Todas las categorías", "Instructor", "Ministro"]);
  });

  it("muestra un estado vacío entendible cuando no hay personas registradas", async () => {
    getPeople.mockResolvedValueOnce(
      samplePage({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }),
    );
    render(<PeopleManager />);

    await waitFor(() =>
      expect(screen.getByText("Todavía no hay personas registradas")).toBeInTheDocument(),
    );
  });

  it("muestra un error entendible con opción de reintentar si la carga falla", async () => {
    getPeople.mockRejectedValueOnce(new Error("No se pudo conectar con el servidor."));
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("abre el formulario de alta al pulsar «Nueva persona»", async () => {
    getPeople.mockResolvedValue(samplePage());
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nueva persona" }));

    expect(screen.getByRole("heading", { name: "Nueva persona" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre completo/)).toBeInTheDocument();
  });

  it("el formulario de alta tiene una casilla «Joven» opcional, sin marcar por defecto, y la manda en el alta", async () => {
    getPeople.mockResolvedValue(samplePage());
    createPerson.mockResolvedValueOnce({ id: "9", fullName: "Nueva Persona", category: "MINISTRO", isJoven: true });
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nueva persona" }));

    const dialog = screen.getByRole("dialog");
    const youthCheckbox = within(dialog).getByRole("checkbox", { name: "Joven" });
    expect(youthCheckbox).not.toBeChecked();

    fireEvent.change(within(dialog).getByLabelText(/Nombre completo/), { target: { value: "Nueva Persona" } });
    await user.selectOptions(within(dialog).getByLabelText(/^Categoría/), "MINISTRO");
    await user.click(youthCheckbox);
    expect(youthCheckbox).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Crear persona" }));

    await waitFor(() =>
      expect(createPerson).toHaveBeenCalledWith(expect.objectContaining({ isJoven: true })),
    );
  });

  it("el formulario de edición precarga el valor actual de «Joven»", async () => {
    getPeople.mockResolvedValueOnce(
      samplePage({
        data: [
          {
            id: "1",
            fullName: "Ana Gómez",
            documentId: "1234567",
            category: "INSTRUCTOR",
            isJoven: true,
            active: true,
            notes: null,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Editar a Ana Gómez" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: "Joven" })).toBeChecked();
  });

  it("la tabla muestra una insignia «Joven» solo cuando la persona está marcada como tal", async () => {
    getPeople.mockResolvedValueOnce(
      samplePage({
        data: [
          { id: "1", fullName: "Ana Gómez", documentId: "1234567", category: "INSTRUCTOR", isJoven: true, active: true, notes: null },
          { id: "2", fullName: "Beto Ruiz", documentId: "7654321", category: "MINISTRO", isJoven: false, active: true, notes: null },
        ],
        pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      }),
    );
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    const table = within(screen.getByRole("table"));
    const anaRow = table.getByText("Ana Gómez").closest("tr");
    const betoRow = table.getByText("Beto Ruiz").closest("tr");
    expect(within(anaRow).getByText("Joven")).toBeInTheDocument();
    expect(within(betoRow).queryByText("Joven")).not.toBeInTheDocument();
  });

  it("la acción de baja se llama «Inactivar», no «Dar de baja»", async () => {
    getPeople.mockResolvedValue(samplePage());
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Inactivar a Ana Gómez" })).toBeInTheDocument();
    expect(screen.queryByText(/dar de baja/i)).not.toBeInTheDocument();
  });

  it("el filtro «Estado» permite pedir solo inactivas o todas, no solo activas/checkbox", async () => {
    getPeople.mockResolvedValue(samplePage());
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    expect(getPeople).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));

    await user.selectOptions(screen.getByLabelText("Estado"), "inactive");
    await waitFor(() => expect(getPeople).toHaveBeenLastCalledWith(expect.objectContaining({ active: false })));

    await user.selectOptions(screen.getByLabelText("Estado"), "all");
    await waitFor(() => {
      const lastCall = getPeople.mock.calls.at(-1)[0];
      expect(lastCall).not.toHaveProperty("active");
    });
  });

  it("el filtro «Joven» permite pedir solo jóvenes o solo no jóvenes, además de todas", async () => {
    getPeople.mockResolvedValue(samplePage());
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    expect(getPeople).toHaveBeenLastCalledWith(expect.not.objectContaining({ isJoven: expect.anything() }));

    await user.selectOptions(screen.getByLabelText("Joven"), "yes");
    await waitFor(() => expect(getPeople).toHaveBeenLastCalledWith(expect.objectContaining({ isJoven: true })));

    await user.selectOptions(screen.getByLabelText("Joven"), "no");
    await waitFor(() => expect(getPeople).toHaveBeenLastCalledWith(expect.objectContaining({ isJoven: false })));

    await user.selectOptions(screen.getByLabelText("Joven"), "all");
    await waitFor(() => {
      const lastCall = getPeople.mock.calls.at(-1)[0];
      expect(lastCall).not.toHaveProperty("isJoven");
    });
  });

  it("permite seleccionar varias personas y cambiar su marca de Joven en lote", async () => {
    getPeople.mockResolvedValue(
      samplePage({
        data: [
          { id: "1", fullName: "Ana Gómez", documentId: "1234567", category: "INSTRUCTOR", isJoven: false, active: true, notes: null },
          { id: "2", fullName: "Beto Ruiz", documentId: "7654321", category: "MINISTRO", isJoven: false, active: true, notes: null },
        ],
        pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      }),
    );
    updatePerson.mockResolvedValue({ person: { id: "1", fullName: "Ana Gómez" }, warnings: [] });
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Seleccionar varias" }));
    await user.click(screen.getByLabelText("Seleccionar a Ana Gómez"));
    await user.click(screen.getByLabelText("Seleccionar a Beto Ruiz"));

    await user.click(screen.getByRole("button", { name: "Cambiar Joven" }));
    await user.selectOptions(screen.getByLabelText("Marcar como"), "true");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(updatePerson).toHaveBeenCalledTimes(2));
    expect(updatePerson).toHaveBeenCalledWith("1", { isJoven: true });
    expect(updatePerson).toHaveBeenCalledWith("2", { isJoven: true });
    await waitFor(() => expect(screen.queryByText(/seleccionada/)).not.toBeInTheDocument());
  });

  it("la selección múltiple está oculta hasta que se activa, y se puede volver a ocultar", async () => {
    getPeople.mockResolvedValue(samplePage());
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());
    expect(screen.queryByLabelText("Seleccionar a Ana Gómez")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Seleccionar varias" }));
    expect(screen.getByLabelText("Seleccionar a Ana Gómez")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salir de selección múltiple" }));
    expect(screen.queryByLabelText("Seleccionar a Ana Gómez")).not.toBeInTheDocument();
  });

  it("permite seleccionar varias personas y cambiar su categoría en lote", async () => {
    getPeople.mockResolvedValue(
      samplePage({
        data: [
          { id: "1", fullName: "Ana Gómez", documentId: "1234567", category: "INSTRUCTOR", active: true, notes: null },
          { id: "2", fullName: "Beto Ruiz", documentId: "7654321", category: "MINISTRO", active: true, notes: null },
        ],
        pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      }),
    );
    updatePerson.mockResolvedValue({ person: { id: "1", fullName: "Ana Gómez" }, warnings: [] });
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());

    // La selección múltiple arranca oculta: hay que activarla a propósito.
    expect(screen.queryByLabelText("Seleccionar a Ana Gómez")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Seleccionar varias" }));

    await user.click(screen.getByLabelText("Seleccionar a Ana Gómez"));
    await user.click(screen.getByLabelText("Seleccionar a Beto Ruiz"));
    expect(screen.getByText("2 personas seleccionadas")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cambiar categoría" }));
    await user.selectOptions(screen.getByLabelText("Nueva categoría"), "MINISTRO");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(updatePerson).toHaveBeenCalledTimes(2));
    expect(updatePerson).toHaveBeenCalledWith("1", { category: "MINISTRO" });
    expect(updatePerson).toHaveBeenCalledWith("2", { category: "MINISTRO" });
    // Tras aplicar, la selección se limpia y se refresca el listado.
    await waitFor(() => expect(screen.queryByText(/seleccionada/)).not.toBeInTheDocument());
  });

  it("la paginación ofrece botones numéricos para saltar directo a una página", async () => {
    getPeople.mockResolvedValue(
      samplePage({ pagination: { page: 1, pageSize: 25, total: 100, totalPages: 4 } }),
    );
    const user = userEvent.setup();
    render(<PeopleManager />);

    await waitFor(() => expect(screen.getByText("Ana Gómez")).toBeInTheDocument());

    const pageThreeButton = screen.getByRole("button", { name: "Ir a la página 3" });
    await user.click(pageThreeButton);

    await waitFor(() => expect(getPeople).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 })));
  });
});
