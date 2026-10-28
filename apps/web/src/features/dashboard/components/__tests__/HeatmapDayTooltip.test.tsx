import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DailyBackupPoint } from "../../types";
import { HeatmapDayTooltip } from "../backups-heatmap/HeatmapDayTooltip";

function point(completed: number, failed: number): DailyBackupPoint {
  return {
    date: "2026-10-27",
    completed,
    failed,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    maxDurationSeconds: null,
    totalSizeMb: 0,
  };
}

describe("HeatmapDayTooltip", () => {
  it("shows both counts and the success rate of the day", () => {
    render(<HeatmapDayTooltip day={point(24, 1)} />);

    expect(screen.getByText("Completados")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("Fallidos")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Tasa de éxito")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();
  });

  it("shows an em dash for the rate of a day with no backups, not 0% or 100%", () => {
    render(<HeatmapDayTooltip day={point(0, 0)} />);

    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("shows 0% for a day where every backup failed", () => {
    render(<HeatmapDayTooltip day={point(0, 4)} />);

    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("marks each status with an icon as well as a color and a word", () => {
    const { container } = render(<HeatmapDayTooltip day={point(3, 2)} />);

    // One glyph per status row, hidden from screen readers: the word carries the meaning.
    expect(container.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(2);
  });

  it("copes with a day the series does not have", () => {
    render(<HeatmapDayTooltip day={undefined} />);

    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
