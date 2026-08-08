import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UniformsManager } from "../pages/UniformsManager.jsx";
import { ToastViewport } from "../components/ui/Toast.jsx";

// Se mockea `api/uniforms.js` completo para controlar cada escenario (alta,
// edición, filtros, duplicado) sin depender de un servidor real. Contrato
// cerrado: docs/architecture/phase4b-schedule-refinements-contract.md §3-4
// (la vista vuelve a ser CRUD puro: ya no existen los endpoints de
// configuración por día de semana / Servicio de jóvenes).
vi.mock("../api/uniforms.js", () => ({
  getUniforms: vi.fn(),
  createUniform: vi.fn(),
  updateUniform: vi.fn(),
}));

import { getUniforms, createUniform, updateUniform } from "../api/uniforms.js";
import { ApiError } from "../api/client.js";

function sampleUniforms() {
  return [
    { id: "u-1", name: "Uniforme A", colorHex: "#1E40AF", description: "Camisa azul", active: true },
    { id: "u-2", name: "Uniforme B", colorHex: "#16A34A", description: null, active: false },
  ];
}

function renderPage() {
  return render(
    <>
      <UniformsManager />
      <ToastViewport />
    </>,
  );
}

describe("UniformsManager", () => {
  beforeEach(() => {
    getUniforms.mockReset();
    createUniform.mockReset();
    updateUniform.mockReset();

    getUniforms.mockResolvedValue(sampleUniforms());
  });

  it("lista los uniformes existentes, activos e inactivos, numerados", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());
    expect(screen.getAllByText("Uniforme A").length).toBeGreaterThan(0);
    expect(screen.getByText("Uniforme B")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();

    // Columna "#" con numeración absoluta sobre la lista cargada.
    const row1 = screen.getByText("Camisa azul").closest("tr");
    expect(within(row1).getByText("1")).toBeInTheDocument();
  });

  it("permite crear un uniforme nuevo", async () => {
    createUniform.mockResolvedValueOnce({
      id: "u-3",
      name: "Uniforme C",
      colorHex: "#1d4ed8",
      description: "",
      active: true,
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Nuevo uniforme" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Nombre/), { target: { value: "Uniforme C" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear uniforme" }));

    await waitFor(() =>
      expect(createUniform).toHaveBeenCalledWith(expect.objectContaining({ name: "Uniforme C" })),
    );
    await waitFor(() => expect(screen.getByText("Se creó el uniforme.")).toBeInTheDocument());
  });

  it("permite editar un uniforme existente, incluida su bandera de activo", async () => {
    updateUniform.mockResolvedValueOnce({
      id: "u-1",
      name: "Uniforme A",
      colorHex: "#1E40AF",
      description: "Camisa azul",
      active: false,
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    const row = screen.getByText("Camisa azul").closest("tr");
    await user.click(within(row).getByRole("button", { name: "Editar" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Nombre/)).toHaveValue("Uniforme A");
    await user.click(within(dialog).getByRole("checkbox", { name: "Uniforme activo" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(updateUniform).toHaveBeenCalledWith("u-1", expect.objectContaining({ active: false })),
    );
  });

  it("muestra UNIFORME_DUPLICADO de forma clara al crear un uniforme repetido", async () => {
    createUniform.mockRejectedValueOnce(
      new ApiError("Ya existe.", { status: 409, details: { code: "UNIFORME_DUPLICADO" } }),
    );
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Nuevo uniforme" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Nombre/), { target: { value: "Uniforme A" } });
    await user.click(within(dialog).getByRole("button", { name: "Crear uniforme" }));

    await waitFor(() =>
      expect(screen.getByText("Ya existe un uniforme con ese nombre.")).toBeInTheDocument(),
    );
  });

  it("filtra por nombre (texto libre)", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Buscar por nombre"), "Uniforme B");

    await waitFor(() => expect(screen.queryByText("Camisa azul")).not.toBeInTheDocument());
    expect(screen.getByText("Uniforme B")).toBeInTheDocument();
  });

  it("filtra por color, ofreciendo solo los colores en uso", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    const colorSelect = screen.getByLabelText("Color");
    expect(within(colorSelect).getByRole("option", { name: "Azul" })).toBeInTheDocument();
    expect(within(colorSelect).getByRole("option", { name: "Verde" })).toBeInTheDocument();

    await user.selectOptions(colorSelect, "#1E40AF");

    expect(screen.getByText("Camisa azul")).toBeInTheDocument();
    expect(screen.queryByText("Uniforme B")).not.toBeInTheDocument();
  });

  it("filtra por estado (activo/inactivo/todos)", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());
    expect(screen.getByText("Uniforme B")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Estado"), "active");

    expect(screen.getByText("Camisa azul")).toBeInTheDocument();
    expect(screen.queryByText("Uniforme B")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Estado"), "inactive");

    expect(screen.queryByText("Camisa azul")).not.toBeInTheDocument();
    expect(screen.getByText("Uniforme B")).toBeInTheDocument();
  });

  it("el picker de colores ofrece la paleta y un modo personalizado", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Camisa azul")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Nuevo uniforme" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("button", { name: "Azul" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Café" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Rojo" }));
    await user.click(within(dialog).getByRole("button", { name: "Personalizado" }));

    expect(within(dialog).getByText("#DC2626")).toBeInTheDocument();
  });

  it("al editar un uniforme con un color fuera de la paleta, abre el picker en modo personalizado", async () => {
    getUniforms.mockResolvedValue([
      { id: "u-4", name: "Uniforme D", colorHex: "#123456", description: null, active: true },
    ]);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Uniforme D")).toBeInTheDocument());

    const row = screen.getByText("Uniforme D").closest("tr");
    await user.click(within(row).getByRole("button", { name: "Editar" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("#123456")).toBeInTheDocument();
  });
});
