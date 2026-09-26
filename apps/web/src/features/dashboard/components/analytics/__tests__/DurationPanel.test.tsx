import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { mockChartSize } from "@/test/chart-env";
import { DurationPanel } from "../DurationPanel";
import type { DailyBackupPoint } from "../../../types";

const days: DailyBackupPoint[] = [
  { date: "2026-09-01", completed: 4, failed: 1, p50DurationSeconds: 10, p95DurationSeconds: 20, totalSizeMb: 100 },
  { date: "2026-09-02", completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
];

describe("DurationPanel", () => {
  it("mounts the line chart without throwing, even with a null day", async () => {
    mockChartSize(320, 88);
    const { container } = render(<DurationPanel days={days} status="ready" revealSignature="test" />);
    await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  });

  it("shows the latest non-null p95 as the panel figure", async () => {
    mockChartSize(320, 88);
    render(<DurationPanel days={days} status="ready" revealSignature="test" />);
    expect(await screen.findByText("20s")).toBeInTheDocument();
  });

  it("shows an em dash figure when every day is null", async () => {
    mockChartSize(320, 88);
    const allNull: DailyBackupPoint[] = [days[1]];
    render(<DurationPanel days={allNull} status="ready" revealSignature="test" />);
    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});
