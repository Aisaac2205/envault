import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricStrip } from "../MetricStrip";
import type { DashboardStats, ConnectionEntity, DailyBackupCount } from "../../types";

const stats: DashboardStats = {
  successRate30d: 98.4,
  backupsToday: 3,
  failed7d: 2,
  totalStorageMb: 1024,
};

const connections: ConnectionEntity[] = [
  { id: "c1", name: "prod-db", dbType: "postgres", environment: "production", isActive: true },
  { id: "c2", name: "stg-db", dbType: "postgres", environment: "staging", isActive: false },
];

const dailyCounts: DailyBackupCount[] = Array.from({ length: 7 }, (_, i) => ({
  date: `2026-09-0${i + 1}`,
  scheduled: i + 1,
  manual: 0,
}));

describe("MetricStrip", () => {
  it("shows all four metrics with mono tabular-nums values in one shared surface", () => {
    const { container } = render(<MetricStrip stats={stats} connections={connections} dailyCounts={dailyCounts} />);

    expect(screen.getByText("98.4%")).toHaveClass("font-mono", "tabular-nums");
    expect(screen.getByText("28")).toBeInTheDocument(); // 1+2+3+4+5+6+7
    expect(screen.getByText("2")).toHaveClass("text-error");
    expect(screen.getByText("1/2")).toBeInTheDocument();

    // one shared surface, not four separate cards
    expect(container.querySelectorAll(".bg-hairline")).toHaveLength(1);
  });

  it("renders a dash for the success rate when stats are not loaded yet", () => {
    render(<MetricStrip stats={null} connections={[]} dailyCounts={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not apply the error tone when there are no failures", () => {
    const okStats = { ...stats, failed7d: 0 };
    render(<MetricStrip stats={okStats} connections={connections} dailyCounts={dailyCounts} />);
    expect(screen.getByText("0")).not.toHaveClass("text-error");
  });
});
