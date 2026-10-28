import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Legend, LegendItem, LegendLabel, LegendValue } from "./index";

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
