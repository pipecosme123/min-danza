import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelect } from "../components/ui/SearchableSelect.jsx";

const OPTIONS = [
  { value: "p-1", label: "Ana Pérez" },
  { value: "p-2", label: "Luis Gómez" },
  { value: "p-3", label: "José Ruiz" },
];

// Componente de prueba controlado, tal como lo usaría PublicSchedule.
function ControlledSelect({ initialValue = "" }) {
  const [value, setValue] = useState(initialValue);
  return (
    <SearchableSelect
      label="Buscar mi equipo"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      placeholder="Escribe un nombre..."
      clearLabel="Todas las personas"
    />
  );
}

describe("SearchableSelect", () => {
  it("muestra todas las opciones (más la de limpiar) al enfocar el input", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    await user.click(screen.getByLabelText("Buscar mi equipo"));

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Todas las personas",
      "Ana Pérez",
      "Luis Gómez",
      "José Ruiz",
    ]);
  });

  it("filtra las opciones al escribir, sin distinguir mayúsculas ni acentos", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    const input = screen.getByLabelText("Buscar mi equipo");
    await user.type(input, "jose");

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    // La opción de limpiar sigue disponible, además de la coincidencia.
    expect(options.map((option) => option.textContent)).toEqual(["Todas las personas", "José Ruiz"]);
  });

  it("muestra un mensaje de «Sin coincidencias» si el texto no matchea a nadie", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    const input = screen.getByLabelText("Buscar mi equipo");
    await user.type(input, "xyz-no-existe");

    expect(screen.getByText("Sin coincidencias")).toBeInTheDocument();
    // La opción de limpiar sigue presente aunque no haya coincidencias.
    expect(screen.getByRole("option", { name: "Todas las personas" })).toBeInTheDocument();
  });

  it("selecciona una opción con click: el input muestra su nombre y la lista se cierra", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    const input = screen.getByLabelText("Buscar mi equipo");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Luis Gómez" }));

    expect(input).toHaveValue("Luis Gómez");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navega con flechas y confirma con Enter", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect />);

    const input = screen.getByLabelText("Buscar mi equipo");
    await user.click(input);
    // Baja hasta "Ana Pérez" (índice 1: 0 es "Todas las personas").
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(input).toHaveValue("Ana Pérez");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("limpia la selección eligiendo el clearLabel", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect initialValue="p-2" />);

    const input = screen.getByLabelText("Buscar mi equipo");
    expect(input).toHaveValue("Luis Gómez");

    await user.click(input);
    await user.click(screen.getByRole("option", { name: "Todas las personas" }));

    expect(input).toHaveValue("");
  });

  it("Escape cierra la lista sin cambiar la selección", async () => {
    const user = userEvent.setup();
    render(<ControlledSelect initialValue="p-2" />);

    const input = screen.getByLabelText("Buscar mi equipo");
    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("Luis Gómez");
  });

  it("cierra la lista al hacer click afuera, sin cambiar la selección", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ControlledSelect />
        <button type="button">Afuera</button>
      </div>,
    );

    const input = screen.getByLabelText("Buscar mi equipo");
    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Afuera" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("sincroniza el texto del input cuando `value` cambia desde afuera", async () => {
    function ExternalControl() {
      const [value, setValue] = useState("p-1");
      return (
        <div>
          <SearchableSelect label="Buscar mi equipo" options={OPTIONS} value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue("")}>
            Limpiar desde afuera
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<ExternalControl />);

    const input = screen.getByLabelText("Buscar mi equipo");
    expect(input).toHaveValue("Ana Pérez");

    await user.click(screen.getByRole("button", { name: "Limpiar desde afuera" }));

    expect(input).toHaveValue("");
  });
});
