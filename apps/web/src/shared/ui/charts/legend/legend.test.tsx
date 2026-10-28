import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Legend,
  LegendItem,
  LegendLabel,
  LegendValue,
  type LegendItemData,
} from "./index";

const items = [
  { label: "Median", value: 1.5, color: "#1D4ED8" },
  { label: "Slowest", value: 9, color: "#EA580C" },
];

describe("Legend", () => {
  it("renders one item per entry with its label and value", () => {
    render(
      <Legend items={items}>
        <LegendItem>
          <LegendLabel />
          <LegendValue />
        </LegendItem>
      </Legend>,
    );

    expect(screen.getByText("Median")).toBeInTheDocument();
    expect(screen.getByText("Slowest")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("keeps an item without onClick a plain, hover only element", () => {
    render(
      <Legend items={items}>
        <LegendItem>
          <LegendLabel />
        </LegendItem>
      </Legend>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("makes an item with onClick a toggle button", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Legend items={items}>
        <LegendItem onClick={onClick} pressed={false}>
          <LegendLabel />
        </LegendItem>
      </Legend>,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute("type", "button");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");

    await user.click(buttons[1]!);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe("keys", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders items that share a label, without a duplicate key warning", () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      render(
        <Legend
          items={[
            { label: "Other", value: 3, color: "#0891B2" },
            { label: "Other", value: 5, color: "#7C3AED" },
          ]}
        >
          <LegendItem>
            <LegendLabel />
            <LegendValue />
          </LegendItem>
        </Legend>,
      );

      expect(screen.getAllByText("Other")).toHaveLength(2);
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("keeps an item's element when the order changes, if it has an id", () => {
      // Same label on purpose: only the id can tell the two apart.
      const first = { id: "shop", label: "Backups", value: 1, color: "#5B8C00" };
      const second = { id: "crm", label: "Backups", value: 2, color: "#7C3AED" };
      const renderLegend = (list: LegendItemData[]) => (
        <Legend items={list}>
          <LegendItem>
            <LegendLabel />
          </LegendItem>
        </Legend>
      );
      const { container, rerender } = render(renderLegend([first, second]));
      const [shopNode, crmNode] = Array.from(
        container.querySelectorAll(".legend-container > div"),
      );

      rerender(renderLegend([second, first]));

      const reordered = Array.from(container.querySelectorAll(".legend-container > div"));
      expect(reordered[0]).toBe(crmNode);
      expect(reordered[1]).toBe(shopNode);
    });
  });

  it("reports hover through onHoverChange and marks the hovered item", async () => {
    const onHoverChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Legend hoveredIndex={null} items={items} onHoverChange={onHoverChange}>
        <LegendItem onClick={() => undefined}>
          <LegendLabel />
        </LegendItem>
      </Legend>,
    );

    const [median] = screen.getAllByRole("button");
    await user.hover(median!);
    expect(onHoverChange).toHaveBeenLastCalledWith(0);

    await user.unhover(median!);
    expect(onHoverChange).toHaveBeenLastCalledWith(null);
  });
});
