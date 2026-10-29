import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RestoreActions } from "../RestoreActions";

function renderActions() {
  render(
    <RestoreActions
      canSimulate
      canExecute
      isDryRun
      isLoading={false}
      onSimulate={vi.fn()}
      onExecute={vi.fn()}
    />,
  );
}

describe("RestoreActions: phone layout", () => {
  // Both labels are wider than half of a 360 px card, so the buttons stack below
  // sm and sit side by side from sm up. jsdom ignores CSS, so this pins the class
  // contract; the rendered layout is checked in a browser.
  it("stacks the two actions below sm and lays them out in a row from sm", () => {
    renderActions();

    const simulate = screen.getByRole("button", { name: "Iniciar simulación previa" });
    const restore = screen.getByRole("button", { name: "Iniciar restauración" });
    const row = simulate.parentElement;

    expect(row).toBe(restore.parentElement);
    expect(row).toHaveClass("flex", "flex-col", "sm:flex-row");
    expect(simulate).toHaveClass("sm:flex-1");
    expect(restore).toHaveClass("sm:flex-1");
  });

  it("keeps the dry run first in reading and focus order", () => {
    renderActions();

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Iniciar simulación previa",
      "Iniciar restauración",
    ]);
  });
});
