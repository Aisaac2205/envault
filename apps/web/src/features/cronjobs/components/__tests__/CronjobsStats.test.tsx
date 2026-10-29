import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CronjobsStats } from "../CronjobsStats";
import type { Cronjob } from "../../types";

const cronjobs: Cronjob[] = [
  {
    id: "cj-1",
    name: "Daily Backup",
    connectionId: "conn-1",
    connectionName: "Prod DB",
    schedule: { kind: "daily", time: "02:00" },
    isActive: true,
    lastRunAt: "2026-06-13T02:00:00Z",
    nextRunAt: "2026-06-14T02:00:00Z",
    lastStatus: "completed",
  },
  {
    id: "cj-2",
    name: "Dev Snapshot",
    connectionId: "conn-2",
    connectionName: "Dev DB",
    schedule: { kind: "every_hours", everyHours: 6 },
    isActive: false,
  },
];

describe("CronjobsStats", () => {
  it("lays the cards out two by two on a phone and in one row from lg, like the dashboard KPIs", () => {
    const { container } = render(<CronjobsStats cronjobs={cronjobs} />);

    const grid = container.firstElementChild as HTMLElement;
    expect(grid).toHaveClass("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", { exact: true });
    expect(grid.children).toHaveLength(4);
    for (const item of Array.from(grid.children)) {
      expect(item).toHaveClass("h-full");
    }
  });

  it("lets a status name drop under its count on a phone instead of being cut", () => {
    render(<CronjobsStats cronjobs={cronjobs} />);

    const status = screen.getByText(/^(Completado|Completed)$/);
    expect(status.parentElement).toHaveClass("max-sm:flex-wrap");
  });
});
