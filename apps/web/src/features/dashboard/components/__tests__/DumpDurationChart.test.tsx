import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    window: 30,
    from: days[0]?.date ?? "2026-08-01",
    to: days.at(-1)?.date ?? "2026-08-30",
    timezone: "UTC",
    connectionId: null,
    days,
  };
}

function dateOf(index: number): string {
  return new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
}

/** The default window, with one day (20) that has no completed backup. */
function monthWithGap(): DailyBackupPoint[] {
  return Array.from({ length: 30 }, (_, index) =>
    index === 20 ? day(dateOf(index)) : day(dateOf(index), [1.2, 3.4, 6.8]),
  );
}

/** Every day a little slower than the one before, so each day has its own values. */
function rampingDays(): DailyBackupPoint[] {
  return Array.from({ length: 30 }, (_, index) =>
    day(dateOf(index), [1 + index * 0.1, 2 + index * 0.1, 3 + index * 0.1]),
  );
}

type SeriesName = "p50" | "p95" | "max";

function mainSeriesPath(container: HTMLElement, name: SeriesName) {
  // The first match is the main chart; the brush strip below repeats the colors.
  return container.querySelector<SVGPathElement>(
    `svg path[stroke="var(--chart-duration-${name})"]`,
  );
}

/** Opacity of the group that wraps a series; motion writes it as an SVG attribute. */
function opacityOf(container: HTMLElement, name: SeriesName) {
  const group = mainSeriesPath(container, name)?.closest("g");
  return group ? Number(group.getAttribute("opacity") ?? 1) : null;
}

function mainChartSurface(container: HTMLElement) {
  const surface = container.querySelector("svg g[transform] > rect[fill='transparent']");
  if (!surface) {
    throw new Error("chart interaction surface not found");
  }
  return surface;
}

function hoverMainChart(container: HTMLElement, clientX: number) {
  fireEvent.mouseMove(mainChartSurface(container), { clientX, clientY: 60 });
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
    mockAnalytics({ data: series(monthWithGap()) });

    render(<DumpDurationChart />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Duración de los respaldos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cuánto tardaron los respaldos de cada día"),
    ).toBeInTheDocument();
  });

  it("renders the three legend entries: the short term and a muted word for what it means", () => {
    mockAnalytics({ data: series(monthWithGap()) });

    render(<DumpDurationChart />);

    const legend = screen.getByRole("group", { name: "Leyenda" });
    const entries = [
      { name: "p50 mediana", term: "p50", hint: "mediana" },
      { name: "p95 percentil 95", term: "p95", hint: "percentil 95" },
      { name: "máx. más lento", term: "máx.", hint: "más lento" },
    ];
    for (const { name, term, hint } of entries) {
      const button = within(legend).getByRole("button", { name });
      expect(within(button).getByText(term)).toBeInTheDocument();
      expect(within(button).getByText(hint)).toHaveClass("text-text-secondary");
    }
    expect(legend.textContent).not.toMatch(/[()]/);
  });

  it("describes the chart as an image with a text summary", () => {
    mockAnalytics({ data: series(monthWithGap()) });

    render(<DumpDurationChart />);

    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute("aria-label");
    expect(chart.getAttribute("aria-label")).toContain("1,2 s");
  });

  it("draws p50 solid, p95 dashed and max dotted, each broken at days without data", async () => {
    mockAnalytics({ data: series(monthWithGap()) });

    const { container } = render(<DumpDurationChart />);
    await waitFor(() => {
      expect(mainSeriesPath(container, "p50")).not.toBeNull();
    });

    const p50 = mainSeriesPath(container, "p50");
    const p95 = mainSeriesPath(container, "p95");
    const max = mainSeriesPath(container, "max");
    expect(p50).toHaveAttribute("stroke-width", "2.5");
    expect(p50).not.toHaveAttribute("stroke-dasharray");
    expect(p95).toHaveAttribute("stroke-width", "2");
    expect(p95).toHaveAttribute("stroke-dasharray", "6 4");
    // A butt cap keeps the dash and gap lengths of the pattern.
    expect(p95).toHaveAttribute("stroke-linecap", "butt");
    expect(max).toHaveAttribute("stroke-width", "2");
    expect(max).toHaveAttribute("stroke-dasharray", "0.1 5");
    // A round cap on a near zero dash is what draws the dot.
    expect(max).toHaveAttribute("stroke-linecap", "round");
    for (const path of [p50, p95, max]) {
      // One missing day (index 20) splits each line in two instead of dipping to 0.
      expect((path?.getAttribute("d")?.match(/M/g) ?? []).length).toBe(2);
    }
  });

  it("draws the slowest line first and the median last, so the median is on top", async () => {
    mockAnalytics({ data: series(monthWithGap()) });

    const { container } = render(<DumpDurationChart />);
    await waitFor(() => {
      expect(mainSeriesPath(container, "p50")).not.toBeNull();
    });

    const order = Array.from(container.querySelectorAll("svg path"))
      .map((path) => path.getAttribute("stroke") ?? "")
      .filter((stroke) => stroke.startsWith("var(--chart-duration-"))
      // The brush strip repeats the same three; keep the main chart's.
      .slice(0, 3);
    expect(order).toEqual([
      "var(--chart-duration-max)",
      "var(--chart-duration-p95)",
      "var(--chart-duration-p50)",
    ]);
  });

  it("gives every line a halo in the card color, 3px wider, drawn right behind it", async () => {
    mockAnalytics({ data: series(monthWithGap()) });

    const { container } = render(<DumpDurationChart />);
    await waitFor(() => {
      expect(mainSeriesPath(container, "p50")).not.toBeNull();
    });

    for (const [name, width] of [
      ["p50", "5.5"],
      ["p95", "5"],
      ["max", "5"],
    ] as const) {
      const line = mainSeriesPath(container, name);
      const halo = line?.previousElementSibling;
      expect(halo).toHaveAttribute("stroke", "var(--chart-background)");
      expect(halo).toHaveAttribute("stroke-width", width);
      // Same pattern and cap, so a dashed line knocks out only its own dashes.
      expect(halo?.getAttribute("stroke-dasharray")).toBe(
        line?.getAttribute("stroke-dasharray"),
      );
      expect(halo?.getAttribute("stroke-linecap")).toBe(
        line?.getAttribute("stroke-linecap"),
      );
    }
  });

  it("asks for the 30 day window of every connection by default", () => {
    mockAnalytics({ data: series(monthWithGap()) });

    render(<DumpDurationChart />);

    expect(analytics.useDailyAnalytics).toHaveBeenCalledWith(30, undefined);
  });

  it("renders the loading state without a chart", () => {
    mockAnalytics({ isLoading: true });

    render(<DumpDurationChart />);

    expect(
      screen.getByRole("status", { name: "Cargando duración de los respaldos" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the legend, inert, while the data loads, so the card keeps its height", () => {
    mockAnalytics({ isLoading: true });

    render(<DumpDurationChart />);

    const status = screen.getByRole("status", { name: "Cargando duración de los respaldos" });
    const legend = status.querySelector("[role=\"group\"]");
    expect(legend).not.toBeNull();
    expect(legend).toHaveTextContent("p50 mediana");
    expect(legend).toHaveTextContent("p95 percentil 95");
    expect(legend).toHaveTextContent("máx. más lento");
    // Nothing to click or tab to until there is a chart to emphasize.
    expect(legend?.closest("[inert]")).not.toBeNull();
  });

  it("renders the empty state when no backup completed in the window", () => {
    mockAnalytics({
      data: series(Array.from({ length: 30 }, (_, index) => day(dateOf(index)))),
    });

    render(<DumpDurationChart />);

    expect(
      screen.getByText("Sin respaldos completados en este período"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // The selector stays so the user can go back to all connections.
    expect(screen.getByRole("combobox", { name: "Conexión" })).toBeInTheDocument();
    // The range stays, because it is the window asked of the API: widen it to find data.
    expect(screen.getByRole("group", { name: "Rango rápido" })).toBeInTheDocument();
    expect(screen.getByText(/últimos 30 días/)).toBeInTheDocument();
    // No legend without lines.
    expect(screen.queryByRole("group", { name: "Leyenda" })).not.toBeInTheDocument();
  });

  it("renders the error state with the reason", () => {
    mockAnalytics({ isError: true, error: new Error("boom") });

    render(<DumpDurationChart />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar la duración de los respaldos: boom",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back to a generic reason when the error has no message", () => {
    mockAnalytics({ isError: true, error: null });

    render(<DumpDurationChart />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar la duración de los respaldos: Error desconocido",
    );
  });

  it("keeps the range control while loading and on error", () => {
    for (const state of [{ isLoading: true }, { isError: true, error: new Error("boom") }]) {
      mockAnalytics(state);
      const { unmount } = render(<DumpDurationChart />);

      expect(screen.getByRole("group", { name: "Rango rápido" })).toBeInTheDocument();
      unmount();
    }
  });

  it("describes the latest day with backups when the newest days of the window have none", () => {
    // Data only in the first 10 days; the rest of the window is quiet.
    const days = monthWithGap().map((point, index) =>
      index < 10 ? point : day(point.date),
    );
    mockAnalytics({ data: series(days) });

    render(<DumpDurationChart />);

    const label = screen.getByRole("img").getAttribute("aria-label");
    expect(label).toContain("mediana 1,2 s");
    // The legend no longer repeats the figures: the summary above and the tooltip have them.
    const legend = screen.getByRole("group", { name: "Leyenda" });
    expect(within(legend).queryByText("1,2 s")).not.toBeInTheDocument();
    expect(within(legend).queryByText(/Último día con respaldos/)).not.toBeInTheDocument();
  });

  describe("legend", () => {
    it("has one toggle button per series, none pressed at first", () => {
      mockAnalytics({ data: series(rampingDays()) });

      render(<DumpDurationChart />);

      const legend = screen.getByRole("group", { name: "Leyenda" });
      const buttons = within(legend).getAllByRole("button");
      expect(buttons).toHaveLength(3);
      for (const button of buttons) {
        expect(button).toHaveAttribute("aria-pressed", "false");
      }
    });

    it("is compact: a swatch and a word per series, with no per-day values and no caption", () => {
      const days = rampingDays();
      // The newest day has no backup, which used to make the legend fall back to the day before.
      days[29] = day(days[29]!.date);
      mockAnalytics({ data: series(days) });

      render(<DumpDurationChart />);

      const legend = screen.getByRole("group", { name: "Leyenda" });
      // The three terms and their meaning, nothing else: no figures, no date.
      expect(within(legend).getAllByRole("button").map((button) => button.textContent)).toEqual([
        "p50 mediana",
        "p95 percentil 95",
        "máx. más lento",
      ]);
      expect(within(legend).queryByText("—")).not.toBeInTheDocument();
      expect(within(legend).queryByText(/Último día con respaldos/)).not.toBeInTheDocument();
      // Each entry is the sample of its line plus the word, nothing else.
      for (const button of within(legend).getAllByRole("button")) {
        expect(button.querySelectorAll("svg")).toHaveLength(1);
      }
    });

    it("does not change while the pointer moves over the chart: the tooltip has the values", async () => {
      mockAnalytics({ data: series(rampingDays()) });

      const { container } = render(<DumpDurationChart />);
      const legend = screen.getByRole("group", { name: "Leyenda" });
      const before = legend.textContent;

      // The chart only reacts to the pointer once its reveal animation is over.
      await waitFor(
        () => {
          hoverMainChart(container, 52);
          expect(screen.getByText("1,0 s")).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      expect(within(legend).queryByText("1,0 s")).not.toBeInTheDocument();
      expect(legend.textContent).toBe(before);
    }, 10000);

    it("emphasizes a series on click and resets on the second click", async () => {
      mockAnalytics({ data: series(rampingDays()) });
      const user = userEvent.setup();

      const { container } = render(<DumpDurationChart />);
      await waitFor(() => {
        expect(mainSeriesPath(container, "p50")).not.toBeNull();
      });
      const p95Button = screen.getByRole("button", { name: "p95 percentil 95" });

      await user.click(p95Button);

      expect(p95Button).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(opacityOf(container, "p50")).toBe(0.25);
      });
      expect(opacityOf(container, "max")).toBe(0.25);
      expect(opacityOf(container, "p95")).toBe(1);

      await user.click(p95Button);

      expect(p95Button).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => {
        expect(opacityOf(container, "p50")).toBe(1);
      });
      expect(opacityOf(container, "max")).toBe(1);
    });

    it("moves the emphasis to another series instead of stacking", async () => {
      mockAnalytics({ data: series(rampingDays()) });
      const user = userEvent.setup();

      const { container } = render(<DumpDurationChart />);
      await waitFor(() => {
        expect(mainSeriesPath(container, "p50")).not.toBeNull();
      });
      const p50Button = screen.getByRole("button", { name: "p50 mediana" });
      const maxButton = screen.getByRole("button", { name: "máx. más lento" });

      await user.click(p50Button);
      await user.click(maxButton);

      expect(p50Button).toHaveAttribute("aria-pressed", "false");
      expect(maxButton).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(opacityOf(container, "p50")).toBe(0.25);
      });
      expect(opacityOf(container, "max")).toBe(1);
    });

    it("works from the keyboard", async () => {
      mockAnalytics({ data: series(rampingDays()) });
      const user = userEvent.setup();

      render(<DumpDurationChart />);
      const p50Button = screen.getByRole("button", { name: "p50 mediana" });
      p50Button.focus();

      await user.keyboard("{Enter}");
      expect(p50Button).toHaveAttribute("aria-pressed", "true");

      await user.keyboard(" ");
      expect(p50Button).toHaveAttribute("aria-pressed", "false");
    });

    it("highlights a series while the pointer is over its legend item", async () => {
      mockAnalytics({ data: series(rampingDays()) });
      const user = userEvent.setup();

      const { container } = render(<DumpDurationChart />);
      await waitFor(() => {
        expect(mainSeriesPath(container, "p50")).not.toBeNull();
      });
      const p50Button = screen.getByRole("button", { name: "p50 mediana" });

      await user.hover(p50Button);
      await waitFor(() => {
        expect(opacityOf(container, "max")).toBe(0.25);
      });
      expect(opacityOf(container, "p50")).toBe(1);

      await user.unhover(p50Button);
      await waitFor(() => {
        expect(opacityOf(container, "max")).toBe(1);
      });
    });
  });

  it("filters by the selected connection", async () => {
    mockAnalytics({ data: series(monthWithGap()) });
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
      expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(30, "conn-crm");
    });
  });

  it("keeps the picked window when the connection changes, and the connection when the window does", async () => {
    mockAnalytics({ data: series(monthWithGap()) });
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
    const user = userEvent.setup();

    render(<DumpDurationChart />);
    await user.click(screen.getByRole("button", { name: "7d" }));
    await user.click(screen.getByRole("combobox", { name: "Conexión" }));
    await user.click(await screen.findByRole("option", { name: "CRM" }));

    await waitFor(() => {
      expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(7, "conn-crm");
    });

    await user.click(screen.getByRole("button", { name: "90d" }));

    expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(90, "conn-crm");
  });
});
