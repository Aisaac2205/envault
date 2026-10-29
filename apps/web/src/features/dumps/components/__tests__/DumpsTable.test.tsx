import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DumpsTable } from "../DumpsTable";
import type { BackupJob } from "../../types";

vi.mock("../../api/dumps-api", () => ({
  dumpsApi: { cancelBackup: vi.fn(), getDownloadUrl: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const base: BackupJob = {
  id: "job-1",
  connectionId: "conn-1",
  connectionName: "orders-production-primary",
  environment: "prod",
  dbType: "postgres",
  status: "completed",
  fileKey: "backups/orders.dump",
  fileSizeMb: 12,
  startedAt: "2026-06-13T10:00:00Z",
  completedAt: "2026-06-13T10:01:00Z",
  errorMessage: null,
  triggeredBy: "user-1",
  createdAt: "2026-06-13T10:00:00Z",
};

const failed: BackupJob = {
  ...base,
  id: "job-2",
  connectionName: "billing-db",
  status: "failed",
  fileKey: null,
  fileSizeMb: null,
  errorMessage: "connect ECONNREFUSED 10.0.0.4:5432",
  triggeredBy: "system-cronjob",
};

function renderTable(dumps: BackupJob[] = [base, failed]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DumpsTable dumps={dumps} isLoading={false} total={dumps.length} page={1} pageSize={25} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowOf(name: string) {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

function cellOf(row: HTMLElement, text: string) {
  return within(row).getByText(text).closest("td") as HTMLElement;
}

describe("DumpsTable on narrow screens", () => {
  it("names the table after the backups section", () => {
    renderTable();

    expect(screen.getByRole("region", { name: "Respaldos" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Respaldos" })).toBeInTheDocument();
  });

  it("stacks each backup: connection as title, actions beside it, environment and date as meta", () => {
    renderTable();
    const row = rowOf("orders-production-primary");

    expect(cellOf(row, "orders-production-primary")).toHaveClass("@max-2xl/table:order-1");
    expect(within(row).getByRole("button", { name: "Restaurar respaldo" }).closest("td")).toHaveClass(
      "@max-2xl/table:order-3",
      "relative",
      "z-10",
    );
    expect(cellOf(row, "Producción")).toHaveClass("@max-2xl/table:order-5");
    const date = within(row).getByText((_, el) => el?.tagName === "TIME");
    expect(date).toHaveAttribute("dateTime", "2026-06-13T10:00:00Z");
    expect(date.closest("td")).toHaveClass("@max-2xl/table:order-5");
    expect(date.closest("td")).not.toHaveClass("hidden");
  });

  it("keeps the status and its error readable as a field instead of a truncated line", () => {
    renderTable();
    const row = rowOf("billing-db");

    const status = cellOf(row, "Fallido");
    expect(status).toHaveClass("@max-2xl/table:order-6");
    expect(within(status).getByText("Estado")).toHaveAttribute("aria-hidden", "true");
    expect(within(status).getByText("Conexión rechazada")).toHaveClass("@max-2xl/table:whitespace-normal");
  });

  it("shows the size as a field and leaves origin and storage to wide tables", () => {
    renderTable();
    const row = rowOf("orders-production-primary");

    expect(cellOf(row, "12.00 MB")).toHaveClass("@max-2xl/table:order-6");
    expect(cellOf(row, "Manual")).toHaveClass("@max-4xl/table:hidden");
    expect(within(row).getByAltText("Cloudflare R2").closest("td")).toHaveClass("@max-4xl/table:hidden");
  });

  it("gives the row actions 44px targets on phones", () => {
    renderTable();
    const row = rowOf("orders-production-primary");

    // Not a fixed square: the button grows to fit the downloading label while it works.
    expect(within(row).getByRole("button", { name: "Descargar respaldo" })).toHaveClass("@max-2xl/table:h-11", "@max-2xl/table:min-w-11");
    expect(within(row).getByRole("button", { name: "Restaurar respaldo" })).toHaveClass("@max-2xl/table:h-11");
  });

  it("gives the cancel action of a running backup a 44px target on phones", () => {
    renderTable([{ ...base, status: "running", fileKey: null }]);

    expect(screen.getByRole("button", { name: "Cancelar respaldo" })).toHaveClass("@max-2xl/table:h-11");
  });
});

describe("DumpsTable engine logos", () => {
  it("leads each connection name with the official logo of its engine", () => {
    renderTable([base, { ...failed, dbType: "mysql" }]);

    const postgres = within(rowOf("orders-production-primary")).getByRole("img", { name: "PostgreSQL" });
    expect(postgres.closest("td")).toHaveClass("@max-2xl/table:order-1");
    expect(within(rowOf("billing-db")).getByRole("img", { name: "MySQL" })).toBeInTheDocument();
  });

  it("keeps the name alone when the engine is unknown", () => {
    renderTable([{ ...base, dbType: null }]);

    expect(within(rowOf("orders-production-primary")).queryByRole("img", { name: /PostgreSQL|MySQL/ })).not.toBeInTheDocument();
  });
});
