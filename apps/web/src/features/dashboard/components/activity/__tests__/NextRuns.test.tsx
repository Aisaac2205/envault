import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextRuns } from "../NextRuns";
import type { CronjobEntity } from "../../../types";

function cronjob(overrides: Partial<CronjobEntity>): CronjobEntity {
  return {
    id: "cj1",
    name: "nightly",
    isActive: true,
    cronExpression: "0 3 * * *",
    connectionId: "c1",
    connectionName: "prod-db",
    nextRunAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    lastRunAt: null,
    lastStatus: null,
    ...overrides,
  };
}

describe("NextRuns", () => {
  it("shows the soonest active cronjobs first", () => {
    const jobs = [
      cronjob({ id: "later", name: "weekly", nextRunAt: new Date(Date.now() + 5 * 60 * 60_000).toISOString() }),
      cronjob({ id: "sooner", name: "nightly", nextRunAt: new Date(Date.now() + 10 * 60_000).toISOString() }),
    ];
    render(<NextRuns cronjobs={jobs} />);

    const names = screen.getAllByText(/nightly|weekly/).map((el) => el.textContent);
    expect(names.indexOf("nightly")).toBeLessThan(names.indexOf("weekly"));
  });

  it("shows a +N more count beyond maxItems and a paused count", () => {
    const jobs = [
      cronjob({ id: "a", name: "a" }),
      cronjob({ id: "b", name: "b" }),
      cronjob({ id: "c", name: "c" }),
      cronjob({ id: "d", name: "d" }),
      cronjob({ id: "paused", name: "paused-job", isActive: false }),
    ];
    render(<NextRuns cronjobs={jobs} maxItems={3} />);

    expect(screen.getByText("+1 más")).toBeInTheDocument();
    expect(screen.getByText("1 pausado")).toBeInTheDocument();
  });
});
