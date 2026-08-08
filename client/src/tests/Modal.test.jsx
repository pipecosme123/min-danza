import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../components/ui/Modal.jsx";

// Regresión del hallazgo de accesibilidad: el diálogo debe atrapar el foco.
// Con Tab/Shift+Tab, el foco solo debe circular entre los elementos
// focalizables del propio modal, nunca escaparse hacia el contenido de
// fondo (que sigue montado detrás del backdrop).

function renderModalWithBackgroundButton() {
  return render(
    <>
      <button type="button">Botón de fondo</button>
      <Modal open onClose={vi.fn()} title="Confirmar acción">
        <button type="button">Primero</button>
        <button type="button">Segundo</button>
      </Modal>
    </>,
  );
}

describe("Modal — focus trap", () => {
  it("Tab desde el último elemento vuelve al primero, sin salir del diálogo", async () => {
    const user = userEvent.setup();
    renderModalWithBackgroundButton();

    const closeButton = screen.getByRole("button", { name: "Cerrar" });
    const first = screen.getByRole("button", { name: "Primero" });
    const second = screen.getByRole("button", { name: "Segundo" });

    // El foco inicial cae en el primer elemento focalizable del diálogo
    // (el botón de cerrar, por ser el primero en el DOM).
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();

    await user.tab();
    expect(second).toHaveFocus();

    // Desde el último, Tab debe volver al primero (cerrar), no escapar al fondo.
    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it("Shift+Tab desde el primer elemento va al último, sin salir del diálogo", async () => {
    const user = userEvent.setup();
    renderModalWithBackgroundButton();

    const closeButton = screen.getByRole("button", { name: "Cerrar" });
    const second = screen.getByRole("button", { name: "Segundo" });

    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(second).toHaveFocus();
  });

  it("el botón de fondo nunca recibe foco mientras el modal está abierto", async () => {
    const user = userEvent.setup();
    renderModalWithBackgroundButton();

    const backgroundButton = screen.getByRole("button", { name: "Botón de fondo" });

    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(backgroundButton).not.toHaveFocus();
    }
  });
});

// Regresión: en casi todos los llamadores `onClose` es una función nueva en
// cada render (inline o redeclarada dentro del componente que abre el
// modal). Si el modal contiene un campo controlado, cada tecleo dispara un
// re-render del padre -> nuevo `onClose` -> si el efecto de foco dependiera
// de `onClose`, se re-ejecutaría en cada tecleo y devolvería el foco al
// botón «Cerrar», dejando escribir una sola letra por vez.
function ControlledFormModal() {
  const [value, setValue] = useState("");
  return (
    <Modal open onClose={() => {}} title="Nuevo uniforme">
      <input aria-label="Nombre" value={value} onChange={(event) => setValue(event.target.value)} />
    </Modal>
  );
}

describe("Modal — el foco no se roba en cada re-render del padre", () => {
  it("escribir varias letras seguidas en un campo del modal no devuelve el foco al botón «Cerrar»", async () => {
    const user = userEvent.setup();
    render(<ControlledFormModal />);

    const input = screen.getByLabelText("Nombre");
    await user.click(input);
    await user.type(input, "Uniforme A");

    expect(input).toHaveValue("Uniforme A");
    expect(input).toHaveFocus();
  });
});
