import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DailyBackupPoint, DailyBackupSeries } from "../../types";
import { DumpDurationChart } from "../DumpDurationChart";

const analytics = vi.hoisted(() => ({
  useDailyAnalytics: vi.fn(),
}));
const connections = vi.hoisted(() => ({
  useConnections: vi.fn(),
}));

vi.mock("../../hooks/useDailyAnalytics", () => analytics);
vi.mock("@/features/connections/hooks/useConnections", () => connections);

function day(
  date: string,
  durations: [number | null, number | null, number | null] = [null, null, null],
): DailyBackupPoint {
  return {
    date,
    completed: durations[0] === null ? 0 : 1,
    failed: 0,
    p50DurationSeconds: durations[0],
    p95DurationSeconds: durations[1],
    maxDurationSeconds: durations[2],
    totalSizeMb: 0,
  };
}

function series(days: DailyBackupPoint[]): DailyBackupSeries {
  return {
    window: 90,
    from: days[0]?.date ?? "2026-07-30",
    to: days.at(-1)?.date ?? "2026-10-27",
    timezone: "UTC",
    connectionId: null,
    days,
  };
}

function ninetyDaysWithGap(): DailyBackupPoint[] {
  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
    return index === 80 ? day(date) : day(date, [1.2, 3.4, 6.8]);
  });
}

function mockAnalytics(result: Record<string, unknown>) {
  analytics.useDailyAnalytics.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...result,
  });
}

describe("DumpDurationChart", () => {
  beforeEach(() => {
    // jsdom has no layout; the chart reads its size from clientWidth/clientHeight.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
    connections.useConnections.mockReturnValue({
      data: [
        { id: "conn-shop", name: "Shop" },
        { id: "conn-crm", name: "CRM" },
      ],
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders a real heading and the subtitle", () => {
    mockAnalytics({ data: series(ninetyDaysWithGap()) });

    render(<DumpDurationChart />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Duración de los respaldos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Mediana, percentil 95 y respaldo más lento por día"),
    ).toBeInTheDocument();
  });

  it("renders the three legend labels", () => {
    mockAnalytics({ data: series(ninetyDaysWithGap()) });

    render(<DumpDurationChart />);

    const legend = screen.getByRole("list", { name: "Leyenda" });
    expect(within(legend).getByText("Mediana (p50)")).toBeInTheDocument();
    expect(within(legend).getByText("Percentil 95 (p95)")).toBeInTheDocument();
    expect(within(legend).getByText("Más lento (máx.)")).toBeInTheDocument();
  });

  it("describes the chart as an image with a text summary", () => {
    mockAnalytics({ data: series(ninetyDaysWithGap()) });

    render(<DumpDurationChart />);

    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute("aria-label");
    expect(chart.getAttribute("aria-label")).toContain("1,2 s");
  });

  it("draws p50 solid, p95 dashed and max dotted, each broken at days without data", async () => {
    mockAnalytics({ data: series(ninetyDaysWithGap()) });

    const { container } = render(<DumpDurationChart />);

    const seriesPath = (color: string, width: string) =>
      container.querySelector<SVGPathElement>(
        `svg path[stroke="var(--chart-duration-${color})"][stroke-width="${width}"]`,
      );
    await waitFor(() => {
      expect(seriesPath("p50", "2")).not.toBeNull();
    });

    const p50 = seriesPath("p50", "2");
    const p95 = seriesPath("p95", "1.5");
    const max = seriesPath("max", "1.5");
    expect(p50).not.toHaveAttribute("stroke-dasharray");
    expect(p95).toHaveAttribute("stroke-dasharray", "6 4");
    expect(max).toHaveAttribute("stroke-dasharray", "0.5 4.5");
    for (const path of [p50, p95, max]) {
      // One missing day (index 80) splits each line in two instead of dipping to 0.
      expect((path?.getAttribute("d")?.match(/M/g) ?? []).length).toBe(2);
    }
  });

  it("asks for the 90 day window of every connection by default", () => {
    mockAnalytics({ data: series(ninetyDaysWithGap()) });

    render(<DumpDurationChart />);

    expect(analytics.useDailyAnalytics).toHaveBeenCalledWith(90, undefined);
  });

  it("renders the loading state without a chart", () => {
    mockAnalytics({ isLoading: true });

    render(<DumpDurationChart />);

    expect(
      screen.getByRole("status", { name: "Cargando duración de los respaldos" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the empty state when no backup completed in the window", () => {
    mockAnalytics({
      data: series(Array.from({ length: 90 }, (_, index) =>
        day(new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10)),
      )),
    });

    render(<DumpDurationChart />);

    expect(
      screen.getByText("Sin respaldos completados en este período"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // The selector stays so the user can go back to all connections.
    expect(screen.getByRole("combobox", { name: "Conexión" })).toBeInTheDocument();
  });

  it("renders the error state with the reason", () => {
    mockAnalytics({ isError: true, error: new Error("boom") });

    render(<DumpDurationChart />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar la duración de los respaldos: boom",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("filters by the selected connection", async () => {
    mockAnalytics({ data: series(ninetyDaysWithGap()) });
    // Radix Select relies on pointer capture and scrollIntoView, which jsdom lacks.
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
    const user = userEvent.setup();

    render(<DumpDurationChart />);
    await user.click(screen.getByRole("combobox", { name: "Conexión" }));
    expect(
      await screen.findByRole("option", { name: "Todas las conexiones" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "CRM" }));

    await waitFor(() => {
      expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(90, "conn-crm");
    });
  });
});
