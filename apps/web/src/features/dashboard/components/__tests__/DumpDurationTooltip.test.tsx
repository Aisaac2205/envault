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

    expect(screen.getByText("Mediana (p50)")).toBeInTheDocument();
    expect(screen.getByText("850 ms")).toBeInTheDocument();
    expect(screen.getByText("12,4 s")).toBeInTheDocument();
    expect(screen.getByText("2 m 05 s")).toBeInTheDocument();
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
