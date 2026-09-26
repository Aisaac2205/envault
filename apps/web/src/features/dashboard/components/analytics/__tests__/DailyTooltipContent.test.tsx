import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailyTooltipContent } from "../DailyTooltipContent";
import type { DailyBackupPoint } from "../../../types";

describe("DailyTooltipContent", () => {
  const point: DailyBackupPoint = {
    date: "2026-03-01",
    completed: 12,
    failed: 2,
    p50DurationSeconds: 30,
    p95DurationSeconds: 90,
    totalSizeMb: 512,
  };

  it("renders every value for the day: completed, failed, p50, p95, size", () => {
    render(<DailyTooltipContent point={point} />);

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument();
    expect(screen.getByText("1.5min")).toBeInTheDocument();
    expect(screen.getByText("512")).toBeInTheDocument();
  });

  it("renders a dash for null p50/p95 instead of interpolating", () => {
    render(
      <DailyTooltipContent
        point={{ ...point, p50DurationSeconds: null, p95DurationSeconds: null }}
      />,
    );

    const dashes = screen.getAllByText("—");
    expect(dashes).toHaveLength(2);
  });
});
