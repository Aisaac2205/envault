import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { mockChartSize } from "@/test/chart-env";
import { SizePanel } from "../SizePanel";
import type { DailyBackupPoint } from "../../../types";

const days: DailyBackupPoint[] = [
  { date: "2026-09-01", completed: 4, failed: 1, p50DurationSeconds: 10, p95DurationSeconds: 20, totalSizeMb: 100 },
  { date: "2026-09-02", completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 60 },
];

describe("SizePanel", () => {
  it("mounts the bar chart without throwing", async () => {
    mockChartSize(320, 64);
    const { container } = render(<SizePanel days={days} status="ready" revealSignature="test" />);
    await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  });

  it("shows the window total as the panel figure, with no legend", async () => {
    mockChartSize(320, 64);
    render(<SizePanel days={days} status="ready" revealSignature="test" />);
    expect(await screen.findByText(/160/)).toBeInTheDocument();
    expect(screen.queryByText(/completed/i)).not.toBeInTheDocument();
  });
});
