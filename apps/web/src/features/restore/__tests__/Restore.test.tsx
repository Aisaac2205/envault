import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import i18n from "@/i18n";
import Restore from "../index";
import * as hooks from "../hooks";
import type { Connection, RestoreJob } from "../types";

vi.mock("../hooks", () => ({
  useRestore: vi.fn(),
  useConnections: vi.fn(),
  useSourceConnections: vi.fn(),
  useRestoreHistory: vi.fn(),
}));

vi.mock("@/features/dumps/api/dumps-api", () => ({
  dumpsApi: {
    getBackupById: vi.fn().mockResolvedValue(null),
  },
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Restore />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const mockDevConn: Connection = {
  id: "conn-1",
  name: "Dev DB",
  slug: "dev-db",
  environment: "dev",
  dbType: "postgres",
  host: "localhost",
  port: 5432,
  database: "dev_db",
  isActive: true,
};

const mockProdConn: Connection = {
  id: "prod-1",
  name: "Prod DB",
  slug: "prod-db",
  environment: "prod",
  dbType: "postgres",
  host: "localhost",
  port: 5432,
  database: "prod_db",
  isActive: true,
};

describe("Restore Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hooks.useConnections).mockReturnValue({
      data: [mockDevConn],
      isLoading: false,
      error: null,
    } as unknown as UseQueryResult<Connection[], Error>);
    vi.mocked(hooks.useSourceConnections).mockReturnValue({
      data: [mockProdConn],
      isLoading: false,
    } as unknown as UseQueryResult<Connection[], Error>);
    vi.mocked(hooks.useRestoreHistory).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as UseQueryResult<RestoreJob[], Error>);
  });

  it("renders page header and idle state in Spanish", async () => {
    await i18n.changeLanguage("es");
    vi.mocked(hooks.useRestore).mockReturnValue({
      state: "idle",
      dryRunResult: null,
      restoreJob: null,
      finalStatus: null,
      isLoading: false,
      error: null,
      executeDryRun: vi.fn(),
      confirmRestore: vi.fn(),
      setDone: vi.fn(),
      reset: vi.fn(),
    });

    renderWithProviders();
    expect(screen.getByRole("heading", { name: "Restaurar" })).toBeInTheDocument();
  });

  it("renders GlobalLoadingOverlay with centered blur loader when state is running", async () => {
    await i18n.changeLanguage("es");
    const runningJob: RestoreJob = {
      id: "job-123",
      status: "running",
      createdAt: "2026-08-20",
    };

    vi.mocked(hooks.useRestore).mockReturnValue({
      state: "running",
      dryRunResult: null,
      restoreJob: runningJob,
      finalStatus: null,
      isLoading: true,
      error: null,
      executeDryRun: vi.fn(),
      confirmRestore: vi.fn(),
      setDone: vi.fn(),
      reset: vi.fn(),
    });

    renderWithProviders();

    const statusEl = screen.getByRole("status");
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveTextContent("Restaurando base de datos...");
  });

  it("renders translated button in Spanish when state is done", async () => {
    await i18n.changeLanguage("es");
    const doneJob: RestoreJob = {
      id: "job-123",
      status: "completed",
      createdAt: "2026-08-20",
    };

    vi.mocked(hooks.useRestore).mockReturnValue({
      state: "done",
      dryRunResult: null,
      restoreJob: doneJob,
      finalStatus: "completed",
      isLoading: false,
      error: null,
      executeDryRun: vi.fn(),
      confirmRestore: vi.fn(),
      setDone: vi.fn(),
      reset: vi.fn(),
    });

    renderWithProviders();

    expect(screen.getByText("La restauración se completó correctamente")).toBeInTheDocument();
    const backBtn = screen.getByRole("button", { name: "Volver al inicio" });
    expect(backBtn).toBeInTheDocument();
  });

  it("renders translated button in English when language is en", async () => {
    await i18n.changeLanguage("en");
    const doneJob: RestoreJob = {
      id: "job-123",
      status: "completed",
      createdAt: "2026-08-20",
    };

    vi.mocked(hooks.useRestore).mockReturnValue({
      state: "done",
      dryRunResult: null,
      restoreJob: doneJob,
      finalStatus: "completed",
      isLoading: false,
      error: null,
      executeDryRun: vi.fn(),
      confirmRestore: vi.fn(),
      setDone: vi.fn(),
      reset: vi.fn(),
    });

    renderWithProviders();

    expect(screen.getByText("Restore completed successfully")).toBeInTheDocument();
    const backBtn = screen.getByRole("button", { name: "Back to home" });
    expect(backBtn).toBeInTheDocument();
  });
});
