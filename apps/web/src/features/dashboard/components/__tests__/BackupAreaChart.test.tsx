import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BackupAreaChart } from "../BackupAreaChart";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("BackupAreaChart", () => {
  const sampleData = [
    { date: daysAgo(2), scheduled: 5, manual: 2 },
    { date: daysAgo(1), scheduled: 3, manual: 1 },
  ];

  it("renders chart with CSS variable colors via ChartContainer", () => {
    render(<BackupAreaChart data={sampleData} />);

    // Verify title is rendered
    expect(screen.getByText("Respaldos completados")).toBeInTheDocument();

    // The chartConfig uses var(--color-info)
    const chartContainer = document.querySelector("[style*='--color-total']");
    expect(chartContainer).toBeTruthy();
  });

  it("renders empty state when data is empty", () => {
    render(<BackupAreaChart data={[]} />);

    expect(screen.getByText(/No hay datos/i)).toBeInTheDocument();
  });
});
