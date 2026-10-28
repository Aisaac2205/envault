import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { BackupJob } from "../../types";
import { RecentFailuresCard } from "../RecentFailuresCard";
import { useEnglishLocale } from "./english-locale";

const failures = vi.hoisted(() => ({ useRecentFailures: vi.fn(), RECENT_FAILURES_LIMIT: 5 }));
vi.mock("../../hooks/useRecentFailures", () => failures);

vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [{ id: "conn-shop", name: "Shop", environment: "production" }],
    isLoading: false,
  }),
}));

// The year only shows for a date of another year, so the rows use the current one.
const YEAR = new Date().getFullYear();

function failed(id: string, over: Partial<BackupJob> = {}): BackupJob {
  const createdAt = new Date(YEAR, 5, 13, 2, 15).toISOString();
  return {
    id,
    connectionId: "conn-shop",
    connectionName: "Shop",
    environment: "production",
    status: "failed",
    fileKey: null,
    fileSizeMb: null,
    startedAt: createdAt,
    completedAt: null,
    errorMessage: "pg_dump: error: connection to server failed",
    triggeredBy: "cron",
    createdAt,
    ...over,
  };
}

function mockFailures(result: Record<string, unknown>) {
  failures.useRecentFailures.mockReturnValue({
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
      <RecentFailuresCard />
    </MemoryRouter>,
  );
}

const list = () => screen.getByRole("list", { name: "Fallos recientes" });

describe("RecentFailuresCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("has a real heading that names its list", () => {
    mockFailures({ data: [failed("a")] });

    renderCard();

    expect(screen.getByRole("heading", { level: 2, name: "Fallos recientes" })).toBeInTheDocument();
    expect(list()).toBeInTheDocument();
  });

  describe("rows", () => {
    it("say which connection failed, when, and why", () => {
      mockFailures({ data: [failed("a")] });

      renderCard();

      const [row] = within(list()).getAllByRole("listitem");
      expect(within(row!).getByText("Shop")).toBeInTheDocument();
      expect(within(row!).getByText("pg_dump: error: connection to server failed")).toBeInTheDocument();
      const time = row!.querySelector("time");
      expect(time).toHaveAttribute("datetime", failed("a").createdAt);
      // "13 jun, 02:15", the full date and time on hover.
      expect(time?.textContent).toMatch(/^13 jun,? 02:15$/);
      expect(time?.getAttribute("title")).toContain(String(YEAR));
    });

    it("show one row per failure, in the order the API sends them", () => {
      mockFailures({
        data: [
          failed("a", { connectionName: "Shop" }),
          failed("b", { connectionName: "CRM", connectionId: "conn-crm" }),
          failed("c", { connectionName: "Blog", connectionId: "conn-blog" }),
        ],
      });

      renderCard();

      const rows = within(list()).getAllByRole("listitem");
      expect(rows.map((row) => row.querySelector("[title]")?.textContent)).toEqual(["Shop", "CRM", "Blog"]);
    });

    it("print only the first line of a long error, clamped to two lines, with all of it on hover", () => {
      const message = "pg_dump: error: query failed: ERROR: permission denied\nDETAIL: table orders\nHINT: grant SELECT";
      mockFailures({ data: [failed("a", { errorMessage: message })] });

      renderCard();

      const line = within(list()).getByText("pg_dump: error: query failed: ERROR: permission denied");
      expect(line).toHaveClass("line-clamp-2");
      expect(line).toHaveAttribute("title", message);
      expect(within(list()).queryByText(/DETAIL/)).not.toBeInTheDocument();
    });

    it("skip blank leading lines to find the first line with words", () => {
      mockFailures({ data: [failed("a", { errorMessage: "\n  \n  Connection refused  \nmore" })] });

      renderCard();

      expect(within(list()).getByText("Connection refused")).toBeInTheDocument();
    });

    it.each([
      ["no error", null],
      ["a blank error", "  \n "],
    ])("say there are no details for %s", (_name, errorMessage) => {
      mockFailures({ data: [failed("a", { errorMessage })] });

      renderCard();

      expect(within(list()).getByText("Sin detalle del error")).toBeInTheDocument();
    });

    it("carry no status badge: the title already says they failed", () => {
      mockFailures({ data: [failed("a")] });

      renderCard();

      expect(within(list()).queryByText("Fallido")).not.toBeInTheDocument();
    });
  });

  it("links to every backup", () => {
    mockFailures({ data: [failed("a")] });

    renderCard();

    expect(screen.getByRole("link", { name: "Ver todos los respaldos" })).toHaveAttribute("href", "/dumps");
  });

  describe("states", () => {
    it("says, with a success icon, that nothing failed when the list is empty", () => {
      mockFailures({ data: [] });

      const { container } = renderCard();

      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      const label = screen.getByText("Sin respaldos fallidos");
      expect(label).toHaveClass("text-text-primary");
      // The state is in the words; the icon only repeats it, in the success color.
      const icon = container.querySelector("svg.text-success");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByRole("link", { name: "Ver todos los respaldos" })).toBeInTheDocument();
    });

    it("shows a busy placeholder while loading", () => {
      mockFailures({ isLoading: true });

      renderCard();

      const status = screen.getByRole("status", { name: "Cargando fallos recientes" });
      // A placeholder per row the card can list.
      expect(status.children).toHaveLength(5);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });

    it("shows the error with its reason and retries on request", async () => {
      const refetch = vi.fn();
      const user = userEvent.setup();
      mockFailures({ isError: true, error: new Error("boom"), refetch });

      renderCard();

      expect(screen.getByText("No se pudieron cargar los fallos recientes: boom")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Reintentar" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("in English", () => {
    useEnglishLocale();

    it("speaks English", () => {
      mockFailures({ data: [failed("a", { errorMessage: null })] });

      renderCard();

      expect(screen.getByRole("heading", { level: 2, name: "Recent failures" })).toBeInTheDocument();
      expect(screen.getByText("No error details")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View all backups" })).toBeInTheDocument();
      expect(screen.getByRole("listitem").querySelector("time")?.textContent).toMatch(/^Jun 13,? 2:15\s?AM$/);
    });

    it("says nothing failed", () => {
      mockFailures({ data: [] });

      renderCard();

      expect(screen.getByText("No failed backups")).toBeInTheDocument();
    });
  });
});
