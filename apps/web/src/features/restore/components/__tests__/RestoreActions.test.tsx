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

describe("RestoreActions: layout by the room the form has", () => {
  // Side by side the two buttons need about 425 px, more than the form column
  // has between 1024 and 1536 px viewports (274-478 px), so the row follows
  // the actions block's own width, not the viewport. jsdom ignores CSS, so this
  // pins the class contract; the rendered layout is checked in a browser.
  it("stacks the two actions full width and lays them out in a row only from 27rem of room", () => {
    renderActions();

    const simulate = screen.getByRole("button", { name: "Iniciar simulación previa" });
    const restore = screen.getByRole("button", { name: "Iniciar restauración" });
    const row = simulate.parentElement as HTMLElement;

    expect(row).toBe(restore.parentElement);
    expect(row.parentElement).toHaveClass("@container/actions");
    expect(row).toHaveClass("flex", "flex-col", "@[27rem]/actions:flex-row");
    expect(row).not.toHaveClass("sm:flex-row");
    expect(simulate).toHaveClass("@[27rem]/actions:flex-1");
    expect(restore).toHaveClass("@[27rem]/actions:flex-1");
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
