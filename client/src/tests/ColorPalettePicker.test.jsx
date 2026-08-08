import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorPalettePicker, UNIFORM_COLOR_PALETTE } from "../components/ui/ColorPalettePicker.jsx";

// Componente de prueba controlado, como lo usaría UniformsManager.
function ControlledPicker({ initialValue = "" }) {
  const [value, setValue] = useState(initialValue);
  return <ColorPalettePicker label="Color" value={value} onChange={setValue} />;
}

describe("ColorPalettePicker", () => {
  it("ofrece un swatch por cada color de la paleta fija más «Personalizado»", () => {
    render(<ControlledPicker />);

    UNIFORM_COLOR_PALETTE.forEach((color) => {
      expect(screen.getByRole("button", { name: color.name })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Personalizado" })).toBeInTheDocument();
  });

  it("al hacer click en un swatch, dispara onChange con su hex y lo marca seleccionado", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker />);

    const rojo = screen.getByRole("button", { name: "Rojo" });
    await user.click(rojo);

    expect(rojo).toHaveAttribute("aria-pressed", "true");
  });

  it("al elegir «Personalizado», revela un input de color con el valor actual", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker />);

    await user.click(screen.getByRole("button", { name: "Personalizado" }));

    // El input nativo type="color" normaliza el valor a minúsculas (sanitización
    // del navegador/jsdom), aunque la paleta lo declare en mayúsculas.
    const customInput = screen.getByDisplayValue(UNIFORM_COLOR_PALETTE[0].hex.toLowerCase());
    expect(customInput).toHaveAttribute("type", "color");
  });

  it("si el valor inicial no coincide con la paleta, abre directamente en modo personalizado sin perder el dato", () => {
    render(<ControlledPicker initialValue="#123456" />);

    expect(screen.getByText("#123456")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
  });
});
