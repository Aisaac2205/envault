import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RestoreHistory } from "../RestoreHistory";
import type { Connection, RestoreJob } from "../../types";

vi.mock("../../api/restore-api", () => ({
  restoreApi: { cancelRestore: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const connections: Connection[] = [
  {
    id: "conn-1",
    name: "orders-db",
    slug: "orders-db",
    environment: "qa",
    dbType: "postgres",
    host: "db.internal",
    port: 5432,
    database: "orders",
    isActive: true,
  },
];

const jobs: RestoreJob[] = [
  {
    id: "job-1",
    targetConnectionId: "conn-1",
    targetEnvironment: "qa",
    status: "completed",
    startedAt: "2026-06-13T10:00:00Z",
    completedAt: "2026-06-13T10:02:05Z",
    createdAt: "2026-06-13T10:00:00Z",
  },
  {
    id: "job-2",
    targetConnectionId: "conn-1",
    targetEnvironment: "dev",
    status: "running",
    startedAt: "2026-06-13T11:00:00Z",
    completedAt: null,
    createdAt: "2026-06-13T11:00:00Z",
  },
];

function renderHistory() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RestoreHistory jobs={jobs} connections={connections} />
    </QueryClientProvider>,
  );
}

function rowWith(text: string) {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

describe("RestoreHistory", () => {
  it("names the history table and its scroll region after the heading", () => {
    renderHistory();

    const region = screen.getByRole("region", { name: "Historial" });
    expect(within(region).getByRole("table", { name: "Historial" })).toBeInTheDocument();
    expect(region).toHaveClass("@container/table", "overflow-auto");
  });

  it("lets the title and the filters wrap instead of widening the page", () => {
    renderHistory();

    const header = screen.getByRole("heading", { name: "Historial" }).parentElement?.parentElement as HTMLElement;
    expect(header).toHaveClass("flex-wrap");
    const filters = screen.getByRole("button", { name: /Estado/ }).parentElement as HTMLElement;
    expect(filters).toHaveClass("flex-wrap");
  });

  it("stacks each job: connection as title, status as badge, start and duration as meta", () => {
    renderHistory();
    const row = rowWith("2m 5s");

    expect(within(row).getByText("orders-db").closest("td")).toHaveClass("@max-2xl/table:order-1", "@max-2xl/table:max-w-none");
    expect(within(row).getByText("Completado").closest("td")).toHaveClass("@max-2xl/table:order-2");

    const start = within(row).getByText((_, el) => el?.tagName === "TIME");
    expect(start).toHaveAttribute("dateTime", "2026-06-13T10:00:00Z");
    expect(start.closest("td")).toHaveClass("@max-2xl/table:order-5");
    const duration = within(row).getByText("2m 5s").closest("td");
    expect(duration).toHaveClass("@max-2xl/table:order-5", "@max-2xl/table:tabular-nums");
  });

  it("shows the environment as a labelled field", () => {
    renderHistory();
    const row = rowWith("2m 5s");

    const env = within(row).getByText("qa").closest("td") as HTMLElement;
    expect(env).toHaveClass("@max-2xl/table:order-6");
    expect(within(env).getByText("Ambiente")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("columnheader", { name: "Ambiente" })).toBeInTheDocument();
  });

  it("keeps the cancel action a 44px target on phones with the same confirmation", async () => {
    const user = userEvent.setup();
    renderHistory();

    const cancel = screen.getByRole("button", { name: "Cancelar restauración" });
    expect(cancel).toHaveClass("relative", "@max-2xl/table:before:-inset-2.5");

    await user.click(cancel);
    expect(await screen.findByRole("dialog", { name: "Cancelar restauración en curso" })).toBeInTheDocument();
  });
});
