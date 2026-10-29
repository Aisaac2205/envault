import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionsStats } from "../components/ConnectionsStats";
import type { Connection } from "../types";

const connection: Connection = {
  id: "conn-1",
  name: "Orders DB",
  slug: "orders-db",
  dbType: "postgres",
  environment: "prod",
  host: "db.internal",
  port: 5432,
  database: "orders",
  username: "orders_user",
  isActive: true,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};

const connections: Connection[] = [
  connection,
  { ...connection, id: "conn-2", slug: "billing-db", dbType: "mysql", environment: "dev", isActive: false },
];

describe("ConnectionsStats", () => {
  it("lays the cards out two by two on a phone and in one row from lg, like the dashboard KPIs", () => {
    const { container } = render(<ConnectionsStats connections={connections} />);

    const grid = container.firstElementChild as HTMLElement;
    expect(grid).toHaveClass("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", { exact: true });
    expect(grid.children).toHaveLength(4);
    for (const item of Array.from(grid.children)) {
      expect(item).toHaveClass("h-full");
    }
  });

  it("lets the engine counts and the environment drop to a second line on a phone instead of being cut", () => {
    render(<ConnectionsStats connections={connections} />);

    const engineCounts = screen.getByAltText("PostgreSQL").parentElement?.parentElement;
    expect(engineCounts).toContainElement(screen.getByAltText("MySQL"));
    expect(engineCounts).toHaveClass("max-sm:flex-wrap", "max-sm:gap-y-1");

    const topEnvironment = screen.getByText("prod").parentElement;
    expect(topEnvironment).toHaveClass("max-sm:flex-wrap");
  });
});
