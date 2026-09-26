import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MicroHistogram } from "../MicroHistogram";

describe("MicroHistogram", () => {
  it("renders one bar per data point with an accessible label", () => {
    const { container } = render(<MicroHistogram data={[1, 2, 3, 4, 5, 6, 7]} ariaLabel="Daily backups: 1, 2, 3, 4, 5, 6, 7" />);

    const img = screen.getByRole("img", { name: "Daily backups: 1, 2, 3, 4, 5, 6, 7" });
    expect(img).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(7);
  });

  it("highlights the last bar (today) with the chart-1 accent", () => {
    const { container } = render(<MicroHistogram data={[1, 2, 3]} ariaLabel="series" />);
    const bars = container.querySelectorAll('[aria-hidden="true"]');

    expect(bars[bars.length - 1]).toHaveClass("bg-chart-1");
    expect(bars[0]).not.toHaveClass("bg-chart-1");
  });

  it("renders nothing for an empty series", () => {
    const { container } = render(<MicroHistogram data={[]} ariaLabel="series" />);
    expect(container).toBeEmptyDOMElement();
  });
});
