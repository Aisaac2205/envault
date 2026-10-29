import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { StoragePanel } from "../StoragePanel";

vi.mock("../../hooks/useMaintenance", () => ({
  useStorageOverview: () => ({
    data: {
      totalDumps: 42,
      totalSizeMb: 12345,
      byConnection: [
        {
          connectionSlug: "orders-db",
          connectionName: "Orders DB",
          count: 42,
          sizeMb: 12345,
          oldest: "2026-08-01T10:00:00Z",
        },
      ],
      byCategory: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [{ id: "conn-1", name: "Orders DB", slug: "orders-db", environment: "prod" }],
  }),
}));

// The retention dialog has its own queries and is closed here.
vi.mock("../RetentionDialog", () => ({ RetentionDialog: () => null }));

describe("StoragePanel", () => {
  it("lays the KPI cards out two by two on a phone and in one row from lg, like the dashboard KPIs", () => {
    const { container } = render(<StoragePanel />);

    // The KPI grid is the panel's first block (no error banner here).
    const grid = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(grid).toHaveClass("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", { exact: true });
    expect(grid.children).toHaveLength(4);
    for (const item of Array.from(grid.children)) {
      expect(item).toHaveClass("h-full");
    }
  });
});
