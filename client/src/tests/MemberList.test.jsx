import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemberList } from "../components/domain/MemberList.jsx";

const members = [
  { id: "1", fullName: "Ana Líder", role: "LEADER", isAdultoMayor: true },
  { id: "2", fullName: "Beto Apoyo", role: "SUPPORT", isAdultoMayor: false },
  { id: "3", fullName: "Cami Ministro", role: "COLLABORATOR", isAdultoMayor: true },
];

describe("MemberList", () => {
  it("en administración: nunca muestra la insignia «Ministro», pero sí «Líder»/«Apoyo» y «Adulto mayor» cuando corresponda", () => {
    render(<MemberList members={members} />);

    const anaItem = screen.getByText("Ana Líder").closest("li");
    const betoItem = screen.getByText("Beto Apoyo").closest("li");
    const camiItem = screen.getByText("Cami Ministro").closest("li");

    expect(within(anaItem).getByText("Líder")).toBeInTheDocument();
    expect(within(anaItem).getByText("Adulto mayor")).toBeInTheDocument();

    expect(within(betoItem).getByText("Apoyo")).toBeInTheDocument();
    expect(within(betoItem).queryByText("Adulto mayor")).not.toBeInTheDocument();

    // Cami es colaboradora (rol COLLABORATOR, "Ministro") -- esa insignia
    // nunca se muestra, en ningún lado; sí se muestra que es adulto mayor.
    expect(within(camiItem).queryByText("Ministro")).not.toBeInTheDocument();
    expect(within(camiItem).getByText("Adulto mayor")).toBeInTheDocument();
  });

  it("en la página pública (onlyShowLeaderRole): solo el líder muestra insignia de rol, y «Adulto mayor» no aparece ni para el líder", () => {
    render(<MemberList members={members} onlyShowLeaderRole />);

    const anaItem = screen.getByText("Ana Líder").closest("li");
    const betoItem = screen.getByText("Beto Apoyo").closest("li");
    const camiItem = screen.getByText("Cami Ministro").closest("li");

    expect(within(anaItem).getByText("Líder")).toBeInTheDocument();
    // Adulto mayor es exclusivo de administración: ni siquiera el líder lo muestra acá.
    expect(within(anaItem).queryByText("Adulto mayor")).not.toBeInTheDocument();

    expect(within(betoItem).queryByText("Apoyo")).not.toBeInTheDocument();
    expect(within(betoItem).queryByText("Adulto mayor")).not.toBeInTheDocument();

    expect(within(camiItem).queryByText("Ministro")).not.toBeInTheDocument();
    expect(within(camiItem).queryByText("Adulto mayor")).not.toBeInTheDocument();
  });
});
