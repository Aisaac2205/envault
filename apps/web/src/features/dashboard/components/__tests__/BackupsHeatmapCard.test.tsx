import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DailyBackupPoint, DailyBackupSeries } from "../../types";
import { BackupsHeatmapCard } from "../BackupsHeatmapCard";
import { useEnglishLocale } from "./english-locale";

const analytics = vi.hoisted(() => ({ useDailyAnalytics: vi.fn() }));
vi.mock("../../hooks/useDailyAnalytics", () => analytics);

const WIDTH = 520;

/** jsdom has no ResizeObserver; the chart is sized from the first notification. */
class FixedWidthObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: WIDTH, height: 0, top: 0, left: 0 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

function point(date: string, completed: number, failed: number): DailyBackupPoint {
  return {
    date,
    completed,
    failed,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    maxDurationSeconds: null,
    totalSizeMb: 0,
  };
}

/** 90 UTC days from 2026-07-30 to 2026-10-27; `filled` sets the days that ran something. */
function quarter(filled: Record<string, [number, number]> = {}): DailyBackupSeries {
  const days = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 27 - (89 - index))).toISOString().slice(0, 10);
    const [completed, failed] = filled[date] ?? [0, 0];
    return point(date, completed, failed);
  });
  return { window: 90, from: days[0]!.date, to: days.at(-1)!.date, timezone: "UTC", connectionId: null, days };
}

/** Four days with backups, two of them with failures (3 and 2 failed: 5 in all). */
function busyQuarter() {
  return quarter({
    "2026-10-20": [20, 3],
    "2026-10-22": [24, 0],
    "2026-10-24": [18, 2],
    "2026-10-27": [24, 0],
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

/** The cell of a day: cells are drawn oldest first, so the day's position in the series is its position here. */
function cellOf(container: HTMLElement, series: DailyBackupSeries, date: string) {
  const rects = Array.from(container.querySelectorAll<SVGRectElement>("rect.visx-heatmap-rect")).filter(
    (_, index) => index % 2 === 0,
  );
  const cell = rects[series.days.findIndex((day) => day.date === date)];
  if (!cell) throw new Error(`no cell for ${date}`);
  return cell;
}

describe("BackupsHeatmapCard", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FixedWidthObserver);
    // Reduced motion: the cells appear at once instead of fading in one by one.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("card", () => {
    it("has a real heading and a subtitle", () => {
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      expect(
        screen.getByRole("heading", { level: 2, name: "Calendario de respaldos" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Respaldos fallidos de cada día en los últimos 90 días, en UTC"),
      ).toBeInTheDocument();
    });

    it("asks for the last 90 days and offers no range buttons", () => {
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      expect(analytics.useDailyAnalytics).toHaveBeenCalledWith(90);
      expect(screen.queryByRole("button", { name: /^(7|30|90)d$/ })).not.toBeInTheDocument();
    });

    it("describes the calendar as an image with the failures of the window", async () => {
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      const label = (await screen.findByRole("img")).getAttribute("aria-label");
      expect(label).toBe(
        "Calendario de respaldos del 30 jul al 27 oct. Respaldos fallidos: 5. Días con fallidos: 2 de 4 con respaldos.",
      );
    });

    it("says so in the description when nothing failed", async () => {
      mockAnalytics({ data: quarter({ "2026-10-26": [24, 0], "2026-10-27": [24, 0] }) });

      render(<BackupsHeatmapCard />);

      const label = (await screen.findByRole("img")).getAttribute("aria-label");
      expect(label).toBe(
        "Calendario de respaldos del 30 jul al 27 oct. Sin respaldos fallidos. Días con respaldos: 2.",
      );
    });

    it("counts a single failed backup on a single day", async () => {
      mockAnalytics({ data: quarter({ "2026-10-27": [24, 1] }) });

      render(<BackupsHeatmapCard />);

      expect((await screen.findByRole("img")).getAttribute("aria-label")).toContain(
        "Respaldos fallidos: 1. Días con fallidos: 1 de 1 con respaldos.",
      );
    });
  });

  describe("legend", () => {
    it("names the five kinds of day, and a day with no backups apart from a day with none failed", () => {
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      const legend = screen.getByRole("group", { name: "Leyenda" });
      for (const label of ["Sin respaldos", "Sin fallidos", "1–2 fallidos", "3–5 fallidos", "6 o más fallidos"]) {
        expect(within(legend).getByText(label), label).toBeInTheDocument();
      }
    });
  });

  describe("summary", () => {
    it("counts the days with failures, the failed backups and the days since the last failure", () => {
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      const stat = (name: string) => screen.getByText(name).closest("[data-stat]") as HTMLElement;
      expect(within(stat("Días con fallidos")).getByText("2")).toBeInTheDocument();
      expect(within(stat("Días con fallidos")).getByText("de 4 días con respaldos")).toBeInTheDocument();
      expect(within(stat("Respaldos fallidos")).getByText("5")).toBeInTheDocument();
      // 86 completed and 5 failed in the window.
      expect(within(stat("Respaldos fallidos")).getByText("94,5% de tasa de éxito")).toBeInTheDocument();
      // The last failure was on the 24th; the 25th, 26th and 27th are clean.
      expect(within(stat("Sin fallidos desde hace")).getByText("3 días")).toBeInTheDocument();
    });
  });

  describe("table view", () => {
    it("lists the days with failures, newest first, for anyone who cannot point at the cells", async () => {
      const user = userEvent.setup();
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      const toggle = screen.getByText("Ver días con fallidos (2)");
      await user.click(toggle);
      const table = screen.getByRole("table", { name: "Días con fallidos" });
      const rows = within(table).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("sáb, 24 oct 2026")).toBeInTheDocument();
      expect(within(rows[0]!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "18"]);
      expect(within(rows[1]!).getByText("mar, 20 oct 2026")).toBeInTheDocument();
    });

    it("is not offered when nothing failed", () => {
      mockAnalytics({ data: quarter({ "2026-10-27": [24, 0] }) });

      render(<BackupsHeatmapCard />);

      expect(screen.queryByText(/Ver días con fallidos/)).not.toBeInTheDocument();
    });
  });

  describe("tooltip", () => {
    it("shows the day, both counts and that day's success rate", async () => {
      const series = busyQuarter();
      mockAnalytics({ data: series });
      const { container } = render(<BackupsHeatmapCard />);

      await waitFor(() => expect(container.querySelector("rect.visx-heatmap-rect")).not.toBeNull());
      fireEvent.pointerEnter(cellOf(container, series, "2026-10-22"));

      const tooltip = await screen.findByTestId("heatmap-day-tooltip");
      expect(screen.getByText("jue, 22 oct 2026")).toBeInTheDocument();
      expect(within(tooltip).getByText("Completados")).toBeInTheDocument();
      expect(within(tooltip).getByText("24")).toBeInTheDocument();
      expect(within(tooltip).getByText("Fallidos")).toBeInTheDocument();
      expect(within(tooltip).getByText("0")).toBeInTheDocument();
      expect(within(tooltip).getByText("100%")).toBeInTheDocument();
    });

    it("shows the failures of a day that had some", async () => {
      const series = busyQuarter();
      mockAnalytics({ data: series });
      const { container } = render(<BackupsHeatmapCard />);

      await waitFor(() => expect(container.querySelector("rect.visx-heatmap-rect")).not.toBeNull());
      fireEvent.pointerEnter(cellOf(container, series, "2026-10-20"));

      const tooltip = await screen.findByTestId("heatmap-day-tooltip");
      expect(within(tooltip).getByText("20")).toBeInTheDocument();
      expect(within(tooltip).getByText("3")).toBeInTheDocument();
      // 20 of 23 finished fine: 86.9%, rounded down so it never reads as more.
      expect(within(tooltip).getByText("86,9%")).toBeInTheDocument();
    });

    it("shows an em dash as the rate of a day with no backups", async () => {
      const series = busyQuarter();
      mockAnalytics({ data: series });
      const { container } = render(<BackupsHeatmapCard />);

      await waitFor(() => expect(container.querySelector("rect.visx-heatmap-rect")).not.toBeNull());
      fireEvent.pointerEnter(cellOf(container, series, "2026-10-21"));

      const tooltip = await screen.findByTestId("heatmap-day-tooltip");
      expect(within(tooltip).getByText("—")).toBeInTheDocument();
      expect(within(tooltip).getAllByText("0")).toHaveLength(2);
    });
  });

  describe("states", () => {
    it("announces the load and draws the empty grid while the data is on its way", () => {
      mockAnalytics({ isLoading: true });

      const { container } = render(<BackupsHeatmapCard />);

      expect(screen.getByRole("status", { name: "Cargando el calendario de respaldos" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Calendario de respaldos" })).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(container.querySelector("[data-stat]")).toBeNull();
      expect(screen.getAllByTestId("heatmap-stat-skeleton")).toHaveLength(3);
    });

    it("explains an empty window instead of drawing a grid of empty days", () => {
      mockAnalytics({ data: quarter() });

      render(<BackupsHeatmapCard />);

      expect(screen.getByRole("heading", { name: "Sin respaldos en este período" })).toBeInTheDocument();
      expect(screen.getByText(/últimos 90 días/, { selector: "p.text-balance" })).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("shows the error with a retry that asks again", async () => {
      const refetch = vi.fn();
      const user = userEvent.setup();
      mockAnalytics({ isError: true, error: new Error("boom"), refetch });

      render(<BackupsHeatmapCard />);

      expect(screen.getByText("No se pudo cargar el calendario de respaldos: boom")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Reintentar" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("in English", () => {
    useEnglishLocale();

    it("speaks English: title, legend, summary and description", async () => {
      mockAnalytics({ data: busyQuarter() });

      render(<BackupsHeatmapCard />);

      expect(screen.getByRole("heading", { level: 2, name: "Backup calendar" })).toBeInTheDocument();
      const legend = screen.getByRole("group", { name: "Legend" });
      for (const label of ["No backups", "None failed", "1–2 failed", "3–5 failed", "6 or more failed"]) {
        expect(within(legend).getByText(label), label).toBeInTheDocument();
      }
      expect(screen.getByText("of 4 days with backups")).toBeInTheDocument();
      expect(screen.getByText("94.5% success rate")).toBeInTheDocument();
      expect((await screen.findByRole("img")).getAttribute("aria-label")).toBe(
        "Backup calendar from Jul 30 to Oct 27. Failed backups: 5. Days with failures: 2 of 4 with backups.",
      );
    });
  });
});
