import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoragePanel } from "../StoragePanel";

const connections = [
  { id: "c1", name: "orders", slug: "orders-primary", environment: "prod", dbType: "postgres" },
  { id: "c2", name: "billing", slug: "billing-eu", environment: "prod", dbType: "mysql" },
  { id: "c3", name: "legacy", slug: "legacy-qa", environment: "prod" },
  { id: "c4", name: "catalog", slug: "catalog-staging", environment: "staging", dbType: "mysql" },
];

vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({ data: connections, isLoading: false }),
}));

vi.mock("../../hooks/useMaintenance", () => ({
  useStorageOverview: () => ({
    data: {
      totalDumps: 12,
      totalSizeMb: 340,
      byConnection: [{ connectionSlug: "orders-primary", connectionName: "orders", count: 12, sizeMb: 340, oldest: "2026-01-01T00:00:00Z" }],
      byCategory: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StoragePanel />
    </QueryClientProvider>,
  );
}

function rowOf(name: string) {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("StoragePanel engine logos", () => {
  it("leads each production connection with the official logo of its engine", () => {
    renderPanel();

    expect(within(rowOf("orders")).getByRole("img", { name: "PostgreSQL" })).toBeInTheDocument();
    expect(within(rowOf("billing")).getByRole("img", { name: "MySQL" })).toBeInTheDocument();
  });

  it("keeps the name alone when the engine is unknown", () => {
    renderPanel();

    expect(within(rowOf("legacy")).queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("StoragePanel table on phones", () => {
  it("scrolls in a named, positioned region, so the hidden actions header never widens the page", () => {
    renderPanel();

    const region = screen.getByRole("region", { name: "Uso de almacenamiento por conexión" });
    expect(region).toHaveClass("relative", "overflow-x-auto");
    expect(region).toContainElement(screen.getByText("Acciones"));
  });
});
