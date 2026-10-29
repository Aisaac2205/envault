import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DumpsStats } from "../DumpsStats";
import type { BackupJob } from "../../types";

const dump: BackupJob = {
  id: "job-1",
  connectionId: "conn-1",
  connectionName: "Orders DB",
  environment: "prod",
  dbType: "postgres",
  status: "completed",
  fileKey: "orders/2026-10-01.sql.gz",
  fileSizeMb: 120,
  startedAt: "2026-10-01T02:00:00Z",
  completedAt: "2026-10-01T02:03:00Z",
  errorMessage: null,
  triggeredBy: "cron",
  createdAt: "2026-10-01T02:00:00Z",
};

describe("DumpsStats", () => {
  it("lays the cards out two by two on a phone and in one row from lg, like the dashboard KPIs", () => {
    const { container } = render(<DumpsStats dumps={[dump, { ...dump, id: "job-2" }]} />);

    const grid = container.firstElementChild as HTMLElement;
    expect(grid).toHaveClass("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", { exact: true });
    expect(grid.children).toHaveLength(4);
    for (const item of Array.from(grid.children)) {
      expect(item).toHaveClass("h-full");
    }
  });
});
