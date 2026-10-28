import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DailyBackupPoint, DailyBackupSeries } from "../../types";
import { BackupsPerDayChart } from "../BackupsPerDayChart";

const analytics = vi.hoisted(() => ({ useDailyAnalytics: vi.fn() }));
vi.mock("../../hooks/useDailyAnalytics", () => analytics);

const NEWEST = 29;

function dateOf(index: number): string {
  return new Date(Date.UTC(2026, 9, 27 - (NEWEST - index))).toISOString().slice(0, 10);
}

function day(index: number, completed: number, failed: number): DailyBackupPoint {
  return {
    date: dateOf(index),
    completed,
    failed,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    maxDurationSeconds: null,
    totalSizeMb: 0,
  };
}

/** 30 zero filled days, with the given days (by index) filled in. */
function month(filled: Record<number, [number, number]> = {}): DailyBackupSeries {
  const days = Array.from({ length: 30 }, (_, index) => {
    const [completed, failed] = filled[index] ?? [0, 0];
    return day(index, completed, failed);
  });
  return {
    window: 30,
    from: days[0]!.date,
    to: days.at(-1)!.date,
    timezone: "UTC",
    connectionId: null,
    days,
  };
}

/** A busy month: the newest day is 24 + 1 (96%), day 10 is 12 + 3 (80%), day 11 is empty. */
function busyMonth() {
  const filled: Record<number, [number, number]> = {};
  for (let index = 0; index < 30; index++) {
    filled[index] = [10 + (index % 5), index % 4 === 0 ? 1 : 0];
  }
  filled[NEWEST] = [24, 1];
  filled[10] = [12, 3];
  filled[11] = [0, 0];
  return month(filled);
}

const fullDate = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dayMonth = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

function localDay(index: number): Date {
  return new Date(2026, 9, 27 - (NEWEST - index));
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

function chartSurface(container: HTMLElement) {
  const surface = container.querySelector("svg g[transform] > rect[fill='transparent']");
  if (!surface) {
    throw new Error("chart interaction surface not found");
  }
  return surface;
}

// Plot: 600 wide, 36 left and 12 right margin, 30 bands of 18.4 px.
const MARGIN_LEFT = 36;
const BAND = (600 - MARGIN_LEFT - 12) / 30;

function hoverDay(container: HTMLElement, index: number) {
  fireEvent.mouseMove(chartSurface(container), {
    clientX: MARGIN_LEFT + BAND * index + BAND / 2,
    clientY: 60,
  });
}

function bars(container: HTMLElement, token: "success" | "error") {
  return Array.from(
    container.querySelectorAll<SVGRectElement>(`svg rect[fill="var(--color-${token})"]`),
  );
}

describe("BackupsPerDayChart", () => {
  beforeEach(() => {
    // jsdom has no layout; the chart reads its size from clientWidth/clientHeight.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
    // A mouse that can hover, and reduced motion: bars skip their grow-in and the
    // chart answers the pointer at once instead of after the reveal.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion") || query.includes("hover: hover"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("card", () => {
    it("has a real heading and a subtitle", () => {
      mockAnalytics({ data: busyMonth() });

      render(<BackupsPerDayChart />);

      expect(
        screen.getByRole("heading", { level: 2, name: "Respaldos por día" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Completados y fallidos de cada día, en UTC")).toBeInTheDocument();
    });

    it("describes the chart as an image with the totals of the window", () => {
      mockAnalytics({ data: month({ 28: [10, 2], 29: [5, 0] }) });

      render(<BackupsPerDayChart />);

      const label = screen.getByRole("img").getAttribute("aria-label");
      expect(label).toContain("Respaldos por día");
      expect(label).toContain("15 completados");
      expect(label).toContain("2 fallidos");
      expect(label).toContain("88,2%");
    });
  });

  describe("window", () => {
    it("asks for 30 days by default and marks 30d as the pressed range", () => {
      mockAnalytics({ data: busyMonth() });

      render(<BackupsPerDayChart />);

      expect(analytics.useDailyAnalytics).toHaveBeenCalledWith(30);
      const range = screen.getByRole("group", { name: "Rango rápido" });
      expect(within(range).getByRole("button", { name: "7d" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(within(range).getByRole("button", { name: "30d" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(within(range).getByRole("button", { name: "90d" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("asks the API for another window when a range is picked", async () => {
      mockAnalytics({ data: busyMonth() });
      const user = userEvent.setup();

      render(<BackupsPerDayChart />);
      await user.click(screen.getByRole("button", { name: "7d" }));

      expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(7);
      expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "false");

      await user.click(screen.getByRole("button", { name: "90d" }));

      expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(90);
    });

    it("keeps the range control while loading, in the empty state and on error", () => {
      for (const state of [
        { isLoading: true },
        { data: month() },
        { isError: true, error: new Error("boom") },
      ]) {
        mockAnalytics(state);
        const { unmount } = render(<BackupsPerDayChart />);

        expect(screen.getByRole("group", { name: "Rango rápido" })).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe("bars", () => {
    it("stacks completed under failed, in the status colors, with a gap between them", () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);

      const completed = bars(container, "success");
      const failed = bars(container, "error");
      // One segment per day for each status.
      expect(completed).toHaveLength(30);
      expect(failed).toHaveLength(30);

      const top = (rect: SVGRectElement) => Number(rect.getAttribute("y"));
      const height = (rect: SVGRectElement) => Number(rect.getAttribute("height"));
      // The newest day: failed sits right above completed, 2px of card color apart.
      const gap = top(completed[NEWEST]!) - (top(failed[NEWEST]!) + height(failed[NEWEST]!));
      expect(gap).toBeCloseTo(2, 5);
      expect(height(failed[NEWEST]!)).toBeGreaterThan(0);
      expect(height(completed[NEWEST]!)).toBeGreaterThan(height(failed[NEWEST]!));
    });

    it("rounds the data ends", () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);

      const radius = Number(bars(container, "success")[NEWEST]!.getAttribute("rx"));
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeLessThanOrEqual(4);
    });

    it("draws a day with no failure without a failed segment", () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);

      // Day 1 has 11 completed and no failure.
      expect(Number(bars(container, "error")[1]!.getAttribute("height"))).toBe(0);
    });

    it("caps how thick a bar gets when the window has few days", () => {
      const week = {
        ...month(),
        window: 7 as const,
        days: Array.from({ length: 7 }, (_, index) => day(index + 23, 8, 1)),
      };
      mockAnalytics({ data: week });

      const { container } = render(<BackupsPerDayChart />);

      const widest = Math.max(
        ...bars(container, "success").map((rect) => Number(rect.getAttribute("width"))),
      );
      expect(widest).toBeLessThanOrEqual(28.5);
      expect(widest).toBeGreaterThan(20);
    });
  });

  describe("x axis", () => {
    it("labels days in the active language and thins them out", () => {
      mockAnalytics({ data: busyMonth() });

      render(<BackupsPerDayChart />);

      // 600px is a narrow chart: 4 labels for 30 days, every 8th day from the first.
      for (const index of [0, 8, 16, 24]) {
        expect(screen.getByText(dayMonth.format(localDay(index)))).toBeInTheDocument();
      }
      for (const index of [1, 5, 9, 20, 29]) {
        expect(screen.queryByText(dayMonth.format(localDay(index)))).not.toBeInTheDocument();
      }
      // Spanish month names, not the chart's built-in English.
      expect(screen.queryByText(/^(Sep|Oct) \d/)).not.toBeInTheDocument();
    });
  });

  describe("legend", () => {
    it("names both statuses and the rate, with an icon on each status", () => {
      mockAnalytics({ data: busyMonth() });

      render(<BackupsPerDayChart />);

      const legend = screen.getByRole("group", { name: "Leyenda" });
      const completed = within(legend).getByRole("button", { name: /Completados/ });
      const failed = within(legend).getByRole("button", { name: /Fallidos/ });
      expect(within(legend).getByText("Tasa de éxito")).toBeInTheDocument();
      // Shape and glyph, so the two states never rely on green versus red.
      expect(completed.querySelector("svg")).not.toBeNull();
      expect(failed.querySelector("svg")).not.toBeNull();
    });

    it("shows the latest day's values, and the day itself", () => {
      mockAnalytics({ data: busyMonth() });

      render(<BackupsPerDayChart />);

      const legend = screen.getByRole("group", { name: "Leyenda" });
      expect(within(legend).getByRole("button", { name: /Completados.*24/ })).toBeInTheDocument();
      expect(within(legend).getByRole("button", { name: /Fallidos.*1/ })).toBeInTheDocument();
      expect(within(legend).getByText("96%")).toBeInTheDocument();
      expect(within(legend).getByText(/Último día con respaldos: /)).toBeInTheDocument();
    });

    it("falls back to the newest day that ran something", () => {
      // The newest day is still empty (it is early in the UTC day).
      mockAnalytics({ data: month({ 27: [6, 2], 28: [0, 0], 29: [0, 0] }) });

      render(<BackupsPerDayChart />);

      const legend = screen.getByRole("group", { name: "Leyenda" });
      expect(within(legend).getByRole("button", { name: /Completados.*6/ })).toBeInTheDocument();
      expect(within(legend).getByRole("button", { name: /Fallidos.*2/ })).toBeInTheDocument();
      expect(within(legend).getByText("75%")).toBeInTheDocument();
    });

    it("shows the values of the hovered day, then goes back to the latest day", async () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);
      const legend = screen.getByRole("group", { name: "Leyenda" });

      hoverDay(container, 10);

      await waitFor(() => {
        expect(within(legend).getByText("80%")).toBeInTheDocument();
      });
      expect(within(legend).getByRole("button", { name: /Completados.*12/ })).toBeInTheDocument();
      expect(within(legend).getByRole("button", { name: /Fallidos.*3/ })).toBeInTheDocument();
      expect(within(legend).getByText(fullDate.format(localDay(10)))).toBeInTheDocument();
      expect(within(legend).queryByText(/Último día con respaldos/)).not.toBeInTheDocument();

      fireEvent.mouseLeave(chartSurface(container));

      await waitFor(() => {
        expect(within(legend).getByText("96%")).toBeInTheDocument();
      });
    });

    it("shows an em dash for the rate of a hovered day with no backups", async () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);
      const legend = screen.getByRole("group", { name: "Leyenda" });

      hoverDay(container, 11);

      await waitFor(() => {
        expect(within(legend).getByText("—")).toBeInTheDocument();
      });
      expect(within(legend).getByRole("button", { name: /Completados.*0/ })).toBeInTheDocument();
    });

    it("emphasizes a status on click: the other one fades, a second click resets", async () => {
      mockAnalytics({ data: busyMonth() });
      const user = userEvent.setup();

      const { container } = render(<BackupsPerDayChart />);
      const failedButton = screen.getByRole("button", { name: /Fallidos/ });
      const opacityOf = (token: "success" | "error") =>
        Number(bars(container, token)[NEWEST]!.getAttribute("opacity") ?? 1);

      await user.click(failedButton);

      expect(failedButton).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => expect(opacityOf("success")).toBe(0.3));
      expect(opacityOf("error")).toBe(1);

      await user.click(failedButton);

      expect(failedButton).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => expect(opacityOf("success")).toBe(1));
    });

    it("works from the keyboard", async () => {
      mockAnalytics({ data: busyMonth() });
      const user = userEvent.setup();

      render(<BackupsPerDayChart />);
      const completedButton = screen.getByRole("button", { name: /Completados/ });
      completedButton.focus();

      await user.keyboard("{Enter}");
      expect(completedButton).toHaveAttribute("aria-pressed", "true");

      await user.keyboard(" ");
      expect(completedButton).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("tooltip", () => {
    it("shows the hovered day: date, both counts and its success rate", async () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);
      hoverDay(container, 10);

      const tooltip = await screen.findByTestId("backups-per-day-tooltip");
      expect(within(tooltip).getByText(fullDate.format(localDay(10)))).toBeInTheDocument();
      expect(within(tooltip).getByText("Completados")).toBeInTheDocument();
      expect(within(tooltip).getByText("12")).toBeInTheDocument();
      expect(within(tooltip).getByText("Fallidos")).toBeInTheDocument();
      expect(within(tooltip).getByText("3")).toBeInTheDocument();
      expect(within(tooltip).getByText("Tasa de éxito")).toBeInTheDocument();
      expect(within(tooltip).getByText("80%")).toBeInTheDocument();
    });

    it("shows an em dash as the rate of a day with 0 + 0", async () => {
      mockAnalytics({ data: busyMonth() });

      const { container } = render(<BackupsPerDayChart />);
      hoverDay(container, 11);

      const tooltip = await screen.findByTestId("backups-per-day-tooltip");
      expect(within(tooltip).getByText("—")).toBeInTheDocument();
      expect(within(tooltip).queryByText("0%")).not.toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("shows a skeleton of the same footprint while loading, without a chart", () => {
      mockAnalytics({ isLoading: true });

      render(<BackupsPerDayChart />);

      expect(
        screen.getByRole("status", { name: "Cargando respaldos por día" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Leyenda" })).not.toBeInTheDocument();
    });

    it("explains an empty window and keeps a wider range one click away", () => {
      mockAnalytics({ data: month() });

      render(<BackupsPerDayChart />);

      expect(
        screen.getByRole("heading", { level: 3, name: "Sin respaldos en este período" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/últimos 30 días/)).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Leyenda" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "90d" })).toBeInTheDocument();
    });

    it("treats a response with no days as empty, not as a crash", () => {
      mockAnalytics({ data: { ...month(), days: [] } });

      render(<BackupsPerDayChart />);

      expect(screen.getByText("Sin respaldos en este período")).toBeInTheDocument();
    });

    it("shows the error with its reason and retries on request", async () => {
      const refetch = vi.fn();
      mockAnalytics({ isError: true, error: new Error("boom"), refetch });
      const user = userEvent.setup();

      render(<BackupsPerDayChart />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudieron cargar los respaldos por día: boom",
      );
      expect(screen.queryByRole("img")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to a generic reason when the error has no message", () => {
      mockAnalytics({ isError: true, error: null });

      render(<BackupsPerDayChart />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudieron cargar los respaldos por día: Error desconocido",
      );
    });
  });
});
