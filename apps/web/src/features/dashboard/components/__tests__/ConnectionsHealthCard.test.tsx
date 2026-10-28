import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ConnectionHealth, ConnectionsHealth, Freshness } from "../../types";
import { ConnectionsHealthCard } from "../ConnectionsHealthCard";
import { useEnglishLocale } from "./english-locale";

const hook = vi.hoisted(() => ({ useConnectionsHealth: vi.fn() }));
vi.mock("../../hooks/useConnectionsHealth", () => hook);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function inFuture(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function connection(
  name: string,
  freshness: Freshness,
  over: Partial<ConnectionHealth> = {},
): ConnectionHealth {
  return {
    connectionId: `id-${name}`,
    connectionName: name,
    environment: "production",
    dbType: "postgres",
    completed: 0,
    failed: 0,
    successRate: null,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    lastBackup: null,
    lastSuccessAt: null,
    schedules: [],
    freshness,
    ...over,
  };
}

const SHOP = connection("Shop", "ok", {
  completed: 249,
  failed: 1,
  successRate: 0.996,
  p50DurationSeconds: 4.1,
  p95DurationSeconds: 9.8,
  lastBackup: {
    status: "completed",
    createdAt: ago(2 * HOUR),
    completedAt: ago(2 * HOUR),
    durationSeconds: 12.4,
    fileSizeMb: 36,
  },
  lastSuccessAt: ago(2 * HOUR),
  schedules: [
    {
      cronjobId: "c-shop",
      nextRunAt: inFuture(25 * MINUTE),
      lastRunAt: ago(2 * HOUR),
      lastStatus: "completed",
      intervalSeconds: 3_600,
    },
  ],
});

const STORE = connection("Store", "stale", {
  dbType: "mysql",
  completed: 10,
  failed: 6,
  successRate: 0.625,
  p50DurationSeconds: 61,
  p95DurationSeconds: 140,
  lastBackup: {
    status: "failed",
    createdAt: ago(5 * 24 * HOUR),
    completedAt: null,
    durationSeconds: null,
    fileSizeMb: null,
  },
  lastSuccessAt: ago(9 * 24 * HOUR),
  schedules: [
    { cronjobId: "c-store", nextRunAt: null, lastRunAt: null, lastStatus: null, intervalSeconds: 86_400 },
  ],
});

const BLOG = connection("Blog", "late", {
  dbType: "mysql",
  completed: 20,
  failed: 0,
  successRate: 1,
  schedules: [
    { cronjobId: "c-blog-1", nextRunAt: inFuture(3 * HOUR), lastRunAt: null, lastStatus: null, intervalSeconds: 57_600 },
    { cronjobId: "c-blog-2", nextRunAt: null, lastRunAt: null, lastStatus: null, intervalSeconds: 604_800 },
  ],
});

const LEGACY = connection("Legacy", "unknown");

function health(connections: ConnectionHealth[]): ConnectionsHealth {
  return {
    window: 30,
    from: "2026-09-28",
    to: "2026-10-27",
    timezone: "UTC",
    overall: { completed: 0, failed: 0, successRate: null, p50DurationSeconds: null, p95DurationSeconds: null },
    connections,
  };
}

function mockHealth(result: Record<string, unknown>) {
  hook.useConnectionsHealth.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...result,
  });
}

function renderCard() {
  return render(
    <MemoryRouter>
      <ConnectionsHealthCard />
    </MemoryRouter>,
  );
}

describe("ConnectionsHealthCard", () => {
  useEnglishLocale();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is a real heading with a one line caption that explains freshness", () => {
    mockHealth({ data: health([SHOP]) });

    renderCard();

    expect(screen.getByRole("heading", { level: 2, name: "Connection status" })).toBeInTheDocument();
    expect(
      screen.getByText(/Overdue: no successful backup for more than 3× the schedule interval/),
    ).toBeInTheDocument();
  });

  describe("rows", () => {
    function table() {
      return screen.getByRole("table", { name: "Connection status" });
    }

    it("orders them stale, late, unknown, then ok", () => {
      mockHealth({ data: health([SHOP, LEGACY, BLOG, STORE]) });

      renderCard();

      const names = within(table())
        .getAllByRole("rowheader")
        .map((header) => header.textContent);
      expect(names).toEqual(["StoreMySQL", "Blog" + "MySQL", "LegacyPG", "ShopPG"]);
    });

    it("names the columns", () => {
      mockHealth({ data: health([SHOP]) });

      renderCard();

      expect(within(table()).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
        "Connection",
        "Freshness",
        "Last backup",
        "Next run",
        "Success · p50 / p95 (30d)",
        "Schedule",
      ]);
    });

    it("shows each freshness state as a badge with its label", () => {
      mockHealth({ data: health([SHOP, LEGACY, BLOG, STORE]) });

      renderCard();

      const rows = within(table()).getAllByRole("row").slice(1);
      expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
        "Overdue",
        "Late",
        "No schedule",
        "On track",
      ]);
    });

    it("tells a healthy connection from a failing one in the last backup column", () => {
      mockHealth({ data: health([SHOP, STORE]) });

      renderCard();

      const [store, shop] = within(table()).getAllByRole("row").slice(1);
      expect(within(store!).getAllByRole("cell")[1]).toHaveTextContent("Failed");
      expect(within(store!).getAllByRole("cell")[1]).toHaveTextContent("5 days ago");
      // A failed backup never produced a dump: its duration is a dash, not "0 ms".
      expect(within(store!).getAllByRole("cell")[1]).toHaveTextContent("5 days ago · —");
      expect(within(shop!).getAllByRole("cell")[1]).toHaveTextContent("Completed");
      expect(within(shop!).getAllByRole("cell")[1]).toHaveTextContent("2 hours ago · 12.4 s");
    });

    it("shows a dash, never 0 ms, for a failed backup that recorded a zero duration", () => {
      const failedAtZero = connection("Zero", "late", {
        lastBackup: { status: "failed", createdAt: ago(3 * HOUR), completedAt: ago(3 * HOUR), durationSeconds: 0, fileSizeMb: null },
      });
      mockHealth({ data: health([failedAtZero]) });

      renderCard();

      const cell = within(within(table()).getAllByRole("row")[1]!).getAllByRole("cell")[1]!;
      expect(cell).toHaveTextContent("Failed");
      expect(cell).toHaveTextContent("3 hours ago · —");
      expect(cell).not.toHaveTextContent("0 ms");
    });

    it("shows a dash for a completed backup without a usable duration, and keeps real ones", () => {
      const noDuration = connection("Missing", "ok", {
        lastBackup: { status: "completed", createdAt: ago(HOUR), completedAt: ago(HOUR), durationSeconds: null, fileSizeMb: 1 },
      });
      const zero = connection("Instant", "ok", {
        lastBackup: { status: "completed", createdAt: ago(HOUR), completedAt: ago(HOUR), durationSeconds: 0, fileSizeMb: 1 },
      });
      const quick = connection("Quick", "ok", {
        lastBackup: { status: "completed", createdAt: ago(HOUR), completedAt: ago(HOUR), durationSeconds: 0.4, fileSizeMb: 1 },
      });
      mockHealth({ data: health([noDuration, zero, quick]) });

      renderCard();

      const cells = within(table())
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[1]!.textContent);
      // The rows are ordered by name within a freshness: Instant, Missing, Quick.
      expect(cells[0]).toContain("1 hour ago · —");
      expect(cells[1]).toContain("1 hour ago · —");
      expect(cells[2]).toContain("1 hour ago · 400 ms");
    });

    it("lets a long connection name wrap to two lines instead of cutting it, with the full name on hover", () => {
      const longName = "e2e-conn-9f3a1c2b-production-primary-replica-eu-west-1 (PG)";
      mockHealth({ data: health([connection(longName, "ok")]) });

      renderCard();

      const name = within(table()).getByText(longName);
      expect(name).toHaveAttribute("title", longName);
      expect(name).toHaveClass("line-clamp-2");
      expect(name).not.toHaveClass("truncate");
      // A name with no spaces still breaks, so it cannot push the columns out of the card.
      expect(name.className).toContain("[overflow-wrap:anywhere]");
    });

    it("says when a connection has never backed up", () => {
      mockHealth({ data: health([LEGACY]) });

      renderCard();

      expect(within(table()).getAllByRole("cell")[1]).toHaveTextContent("No backups yet");
    });

    it("shows the next run as relative time with the exact time on hover, or a dash", () => {
      mockHealth({ data: health([SHOP, STORE]) });

      renderCard();

      const [store, shop] = within(table()).getAllByRole("row").slice(1);
      const next = within(shop!).getAllByRole("cell")[2]!;
      const time = within(next).getByText(/^In 25m$/);
      expect(time.tagName).toBe("TIME");
      expect(time).toHaveAttribute("title", expect.stringMatching(/\d{4}.*\d/));
      expect(time).toHaveAttribute("datetime", SHOP.schedules[0]!.nextRunAt!);
      expect(within(store!).getAllByRole("cell")[2]).toHaveTextContent("—");
    });

    it("shows the earliest next run when a connection has several schedules", () => {
      mockHealth({ data: health([BLOG]) });

      renderCard();

      expect(within(table()).getAllByRole("cell")[2]).toHaveTextContent("In 3h");
    });

    it("shows the success rate, rounded down, with the median and the 95th percentile", () => {
      mockHealth({ data: health([SHOP, LEGACY]) });

      renderCard();

      const [legacy, shop] = within(table()).getAllByRole("row").slice(1);
      const rate = within(shop!).getAllByRole("cell")[3]!;
      expect(rate).toHaveTextContent("99.6%");
      expect(rate).toHaveTextContent("p50 4.1 s p95 9.8 s");
      expect(rate).toHaveTextContent("249 completed, 1 failed");
      // No backup in the window: no rate, never 0% or 100%.
      expect(within(legacy!).getAllByRole("cell")[3]).toHaveTextContent("—");
      expect(within(legacy!).getAllByRole("cell")[3]).toHaveTextContent("p50 — p95 —");
    });

    it("words the schedule: regular, daily, and the largest gap of an irregular one", () => {
      const hourly = connection("Hourly", "ok", {
        schedules: [{ cronjobId: "h", nextRunAt: null, lastRunAt: null, lastStatus: null, intervalSeconds: 3_600 }],
      });
      mockHealth({ data: health([STORE, hourly, BLOG, LEGACY]) });

      renderCard();

      const rows = within(table()).getAllByRole("row").slice(1);
      const schedule = (index: number) => within(rows[index]!).getAllByRole("cell")[4];
      // Sorted: Store (stale), Blog (late), Legacy (unknown), Hourly (ok).
      expect(schedule(0)).toHaveTextContent("daily");
      // 16 h is the largest gap of 0 9,17 * * *, and a second schedule is counted.
      expect(schedule(1)).toHaveTextContent("every 16 h max");
      expect(schedule(1)).toHaveTextContent("and 1 more schedule");
      expect(schedule(2)).toHaveTextContent("—");
      expect(schedule(3)).toHaveTextContent("every 1 h");
    });

    it("renders the same connections as stacked cards for narrow widths", () => {
      mockHealth({ data: health([SHOP, STORE]) });

      renderCard();

      const cards = screen.getAllByRole("listitem");
      expect(cards).toHaveLength(2);
      expect(within(cards[0]!).getByRole("heading", { level: 3, name: "Store" })).toBeInTheDocument();
      expect(within(cards[0]!).getByText("Overdue")).toBeInTheDocument();
      expect(within(cards[0]!).getByText("Last backup")).toBeInTheDocument();
      expect(within(cards[1]!).getByText("99.6%")).toBeInTheDocument();
      expect(within(cards[1]!).getByText("every 1 h")).toBeInTheDocument();
    });

    it("switches between the table and the cards by the width of the card, never by scrolling the page", () => {
      mockHealth({ data: health([SHOP]) });

      const { container } = renderCard();

      expect(table().parentElement).toHaveClass("hidden", "@4xl:block");
      expect(screen.getByRole("list", { name: "Connection status" })).toHaveClass("@4xl:hidden");
      expect(container.querySelector("[class~='@container']")).not.toBeNull();
    });
  });

  describe("window", () => {
    it("asks for the picked window while the first answer is still loading", async () => {
      mockHealth({ isLoading: true });
      const user = userEvent.setup();

      renderCard();
      await user.click(screen.getByRole("button", { name: "7d" }));

      expect(hook.useConnectionsHealth).toHaveBeenLastCalledWith(7);
      expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    });

    it("asks for the picked window after an error, and the error card keeps the control", async () => {
      mockHealth({ isError: true, error: new Error("boom") });
      const user = userEvent.setup();

      renderCard();
      await user.click(screen.getByRole("button", { name: "90d" }));

      expect(hook.useConnectionsHealth).toHaveBeenLastCalledWith(90);
      expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("opens on 30 days and asks for the window the user picks", async () => {
      mockHealth({ data: health([SHOP]) });
      const user = userEvent.setup();

      renderCard();
      expect(hook.useConnectionsHealth).toHaveBeenLastCalledWith(30);

      await user.click(screen.getByRole("button", { name: "7d" }));

      expect(hook.useConnectionsHealth).toHaveBeenLastCalledWith(7);
      expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
      expect(within(screen.getByRole("table")).getAllByRole("columnheader")[4]).toHaveTextContent("(7d)");
    });

    it("names the control for what it changes", () => {
      mockHealth({ data: health([SHOP]) });

      renderCard();

      expect(screen.getByRole("group", { name: "Window of the success rate and durations" })).toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("shows a busy placeholder while loading", () => {
      mockHealth({ isLoading: true });

      renderCard();

      expect(screen.getByRole("status", { name: "Loading connections health" })).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("explains an error and retries on request", async () => {
      const refetch = vi.fn();
      mockHealth({ isError: true, error: new Error("boom"), refetch });
      const user = userEvent.setup();

      renderCard();

      expect(screen.getByRole("alert")).toHaveTextContent("Could not load connections health: boom");
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("leads to the connections page when there is no production connection", () => {
      mockHealth({ data: health([]) });

      renderCard();

      expect(screen.getByRole("heading", { level: 3, name: "No production connections" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to connections" })).toHaveAttribute("href", "/connections");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });
});
