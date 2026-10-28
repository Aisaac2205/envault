import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DumpDurationTooltip } from "../dump-duration/DumpDurationTooltip";

describe("DumpDurationTooltip", () => {
  it("shows the three values in human units", () => {
    render(
      <DumpDurationTooltip
        point={{ date: new Date(2026, 9, 27), p50: 0.85, p95: 12.4, max: 125 }}
      />,
    );

    expect(screen.getByText("850 ms")).toBeInTheDocument();
    expect(screen.getByText("12,4 s")).toBeInTheDocument();
    expect(screen.getByText("2 m 05 s")).toBeInTheDocument();
  });

  it("keys each row with the short term only: the legend already says what it means", () => {
    const { container } = render(
      <DumpDurationTooltip
        point={{ date: new Date(2026, 9, 27), p50: 0.85, p95: 12.4, max: 125 }}
      />,
    );

    for (const term of ["p50", "p95", "máx."]) {
      expect(screen.getByText(term)).toBeInTheDocument();
    }
    for (const hint of ["mediana", "percentil 95", "más lento"]) {
      expect(screen.queryByText(hint, { exact: false })).not.toBeInTheDocument();
    }
    expect(container.textContent).not.toMatch(/[()]/);
  });

  it("shows an em dash, never 0, for a day without a completed backup", () => {
    render(
      <DumpDurationTooltip
        point={{ date: new Date(2026, 9, 27), p50: null, p95: null, max: null }}
      />,
    );

    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/^0 ms$/)).not.toBeInTheDocument();
  });
});
