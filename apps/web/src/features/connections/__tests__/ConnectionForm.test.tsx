import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ConnectionForm from "../components/ConnectionForm";
import type { Connection } from "../types";

const devConnection: Connection = {
  id: "conn-2",
  name: "Orders QA",
  slug: "orders-qa",
  dbType: "postgres",
  environment: "dev",
  host: "db.internal",
  port: 5432,
  database: "orders",
  username: "orders_user",
  isActive: true,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};

function environmentOptions(): string[] {
  const select = screen.getByLabelText("Ambiente");
  return within(select)
    .getAllByRole("option")
    .map((option) => (option as HTMLOptionElement).value);
}

describe("ConnectionForm: environment choices", () => {
  it("offers prod when creating a connection", () => {
    render(<ConnectionForm onSubmit={vi.fn()} onCancel={vi.fn()} isLoading={false} />);

    expect(environmentOptions()).toEqual(["dev", "qa", "prod"]);
  });

  // The API refuses to move a connection to PROD, so editing never offers it.
  it("does not offer prod when editing a connection", () => {
    render(
      <ConnectionForm
        connection={devConnection}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    expect(environmentOptions()).toEqual(["dev", "qa"]);
  });
});
