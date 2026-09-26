import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { mockChartSize } from "@/test/chart-env";
import { OutcomePanel } from "../OutcomePanel";
import type { DailyBackupPoint } from "../../../types";

const days: DailyBackupPoint[] = [
  { date: "2026-09-01", completed: 4, failed: 1, p50DurationSeconds: 10, p95DurationSeconds: 20, totalSizeMb: 100 },
  { date: "2026-09-02", completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
];

describe("OutcomePanel", () => {
  it("mounts the bar chart without throwing", async () => {
    mockChartSize(320, 112);
    const { container } = render(<OutcomePanel days={days} status="ready" revealSignature="test" />);
    await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  });

  it("shows the completed/failed totals as the panel figure", async () => {
    mockChartSize(320, 112);
    render(<OutcomePanel days={days} status="ready" revealSignature="test" />);
    expect(await screen.findByText(/4/)).toBeInTheDocument();
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });

  it("mounts a loading skeleton when status is loading, without data", async () => {
    mockChartSize(320, 112);
    const { container } = render(<OutcomePanel days={[]} status="loading" revealSignature="test" />);
    await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  });
});
