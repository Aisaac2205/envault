import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TrendsDataTable } from "../TrendsDataTable";
import type { DailyBackupPoint } from "../../../types";

describe("TrendsDataTable", () => {
  const points: DailyBackupPoint[] = [
    {
      date: "2026-03-01",
      completed: 5,
      failed: 1,
      p50DurationSeconds: 20,
      p95DurationSeconds: null,
      totalSizeMb: 100,
    },
    {
      date: "2026-03-02",
      completed: 0,
      failed: 0,
      p50DurationSeconds: null,
      p95DurationSeconds: null,
      totalSizeMb: 0,
    },
  ];

  it("is visually hidden but exposed to assistive tech as a table", () => {
    render(<TrendsDataTable points={points} />);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("sr-only");
  });

  it("exposes one row per day with date, completed, failed, p50, p95, size columns", () => {
    render(<TrendsDataTable points={points} />);
    const rows = screen.getAllByRole("row");
    // header row + 2 data rows
    expect(rows).toHaveLength(3);

    const firstRow = within(rows[1]);
    expect(firstRow.getByText("5")).toBeInTheDocument();
    expect(firstRow.getByText("1")).toBeInTheDocument();
    expect(firstRow.getByText("20s")).toBeInTheDocument();
  });

  it("renders a dash for a null duration value instead of 0", () => {
    render(<TrendsDataTable points={points} />);
    const rows = screen.getAllByRole("row");
    const firstDataRow = within(rows[1]);
    const secondDataRow = within(rows[2]);

    expect(firstDataRow.getByText("—")).toBeInTheDocument(); // p95 is null
    expect(secondDataRow.getAllByText("—")).toHaveLength(2); // p50 and p95 both null
  });

  it("renders zero-count days as 0, not omitted", () => {
    render(<TrendsDataTable points={points} />);
    const rows = screen.getAllByRole("row");
    const secondDataRow = within(rows[2]);
    // completed=0, failed=0, size=0 — three zero cells, none omitted.
    expect(secondDataRow.getAllByText("0")).toHaveLength(3);
  });
});
