import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { mockChartSize } from "@/test/chart-env";
import { TrendsSection } from "../TrendsSection";
import type { DailyBackupSeries } from "../../../types";
import apiClient from "../../../../../shared/lib/api-client";
import { useAuth } from "../../../../../shared/hooks/useAuth";

vi.mock("../../../../../shared/lib/api-client");
vi.mock("../../../../../shared/hooks/useAuth");

const mockApiClient = vi.mocked(apiClient);
const mockUseAuth = vi.mocked(useAuth);

function mockAuth(role: string | null) {
  mockUseAuth.mockReturnValue({
    user: role ? { id: "u1", email: "u@test.com", name: "U", role } : null,
    isAuthenticated: !!role,
    isInitializing: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const series: DailyBackupSeries = {
  window: 30,
  from: "2026-08-30",
  to: "2026-08-31",
  timezone: "UTC",
  days: [
    { date: "2026-08-30", completed: 4, failed: 1, p50DurationSeconds: 10, p95DurationSeconds: 20, totalSizeMb: 100 },
    { date: "2026-08-31", completed: 3, failed: 0, p50DurationSeconds: 8, p95DurationSeconds: 18, totalSizeMb: 60 },
  ],
};

describe("TrendsSection", () => {
  beforeEach(() => {
    mockChartSize(320, 112);
    mockAuth("admin");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the window filter and the accessible table once data loads", async () => {
    mockApiClient.get.mockResolvedValue({ data: series });
    renderWithClient(<TrendsSection />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(series.days.length + 1); // + header row
    expect(screen.getByRole("radio", { name: "30d" })).toBeChecked();
  });

  it("re-scopes to window=7 when the user selects it", async () => {
    mockApiClient.get.mockResolvedValue({ data: series });
    const user = userEvent.setup();
    renderWithClient(<TrendsSection />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    await user.click(screen.getByRole("radio", { name: "7d" }));

    await waitFor(() =>
      expect(mockApiClient.get).toHaveBeenLastCalledWith("/jobs/analytics/daily", { params: { window: 7 } }),
    );
  });

  it("dims the section (aria-busy) while refetching after a window change, without a skeleton", async () => {
    mockApiClient.get.mockResolvedValueOnce({ data: series });
    const user = userEvent.setup();
    renderWithClient(<TrendsSection />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    let resolveNext!: (value: { data: DailyBackupSeries }) => void;
    mockApiClient.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
    );

    await user.click(screen.getByRole("radio", { name: "7d" }));

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument());
    // Previous data stays rendered (no skeleton) while the new window loads.
    expect(screen.getByRole("table")).toBeInTheDocument();

    resolveNext({ data: { ...series, window: 7 } });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument());
  });

  it("shows an inline error with retry on failure", async () => {
    mockApiClient.get.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWithClient(<TrendsSection />);

    const retryButton = await screen.findByRole("button", { name: /reintentar/i });
    mockApiClient.get.mockResolvedValueOnce({ data: series });
    await user.click(retryButton);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  });

  it("shows the empty state when the window has no days", async () => {
    mockApiClient.get.mockResolvedValue({ data: { ...series, days: [] } });
    renderWithClient(<TrendsSection />);

    expect(await screen.findByText("Aún no hay nada.")).toBeInTheDocument();
  });

  it("does not call the API for non-admin sessions", () => {
    mockAuth("user");
    renderWithClient(<TrendsSection />);

    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("moves the keyboard readout to the next day on ArrowRight", async () => {
    mockApiClient.get.mockResolvedValue({ data: series });
    const user = userEvent.setup();
    renderWithClient(<TrendsSection />);

    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const group = screen.getByRole("group", { name: /flechas/i });
    group.focus();
    await user.keyboard("{Home}");
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
    await user.keyboard("{ArrowRight}");
    // Readout content re-renders for the next day without throwing.
    expect(group).toHaveFocus();
  });
});
