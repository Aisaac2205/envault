import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import type { ConnectionStorage } from "../../types";
import { StorageByConnectionChart } from "../StorageByConnectionChart";

const storage = vi.hoisted(() => ({ useStorageByConnection: vi.fn() }));
vi.mock("../../hooks/useStorageByConnection", () => storage);

const GB = 1024;

function row(id: string, name: string | null, sizeMb: number, count = 4): ConnectionStorage {
  return { connectionId: id, connectionName: name, totalSizeMb: sizeMb, backupCount: count };
}

/** Three connections that add up to 45 GB: 60%, 30% and 10%. */
function threeConnections() {
  return [row("a", "Shop", 27 * GB, 9), row("b", "CRM", 13.5 * GB, 3), row("c", "Blog", 4.5 * GB, 1)];
}

/** Five connections: the two smallest fold into "2 otras". */
function fiveConnections() {
  return [
    row("a", "Shop", 20 * GB, 10),
    row("b", "CRM", 10 * GB, 5),
    row("c", "Blog", 5 * GB, 3),
    row("d", "Wiki", 3 * GB, 2),
    row("e", "Forum", 2 * GB, 1),
  ];
}

function mockStorage(result: Record<string, unknown>) {
  storage.useStorageByConnection.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...result,
  });
}

function stubMedia({ canHover }: { canHover: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    // Reduced motion: the slices are drawn at once, without their sweep-in.
    matches: query.includes("prefers-reduced-motion") || (canHover && query.includes("hover: hover")),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

const legend = () => screen.getByRole("group", { name: "Leyenda" });
const item = (name: RegExp) => within(legend()).getByRole("button", { name });
/** The invisible hit area of slice `index`, which is what the pointer enters. */
const hitArea = (container: HTMLElement, index: number) =>
  container.querySelectorAll("svg g[style*='cursor'] > path[fill='transparent']")[index]!;
const centerOf = (container: HTMLElement) =>
  container.querySelector("[class*='chart-center']") as HTMLElement;

describe("StorageByConnectionChart", () => {
  beforeEach(() => {
    stubMedia({ canHover: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("card", () => {
    it("has a real heading and a subtitle", () => {
      mockStorage({ data: threeConnections() });

      render(<StorageByConnectionChart />);

      expect(
        screen.getByRole("heading", { level: 2, name: "Almacenamiento por conexión" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Parte de los respaldos almacenados que ocupa cada conexión"),
      ).toBeInTheDocument();
    });

    it("describes the donut as an image with every share", () => {
      mockStorage({ data: threeConnections() });

      render(<StorageByConnectionChart />);

      const label = screen.getByRole("img").getAttribute("aria-label");
      expect(label).toContain("45.00 GB");
      expect(label).toContain("Shop 27.00 GB (60%)");
      expect(label).toContain("CRM 13.50 GB (30%)");
      expect(label).toContain("Blog 4.50 GB (10%)");
    });
  });

  describe("donut", () => {
    it("shows the total, formatted, with a localized label in the center", () => {
      mockStorage({ data: threeConnections() });

      const { container } = render(<StorageByConnectionChart />);

      const center = centerOf(container);
      expect(within(center).getByText("45.00 GB")).toBeInTheDocument();
      expect(within(center).getByText("Total")).toBeInTheDocument();
    });

    it("draws one slice per connection in the categorical colors, in order", () => {
      mockStorage({ data: threeConnections() });

      const { container } = render(<StorageByConnectionChart />);

      const fills = Array.from(container.querySelectorAll("svg path[fill^='var(--chart-']")).map(
        (path) => path.getAttribute("fill"),
      );
      expect(fills).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
    });

    it("folds the connections past the third into one neutral Other slice", () => {
      mockStorage({ data: fiveConnections() });

      const { container } = render(<StorageByConnectionChart />);

      const fills = Array.from(container.querySelectorAll("svg path[fill^='var(--chart-']")).map(
        (path) => path.getAttribute("fill"),
      );
      expect(fills).toEqual([
        "var(--chart-1)",
        "var(--chart-2)",
        "var(--chart-3)",
        "var(--chart-4)",
      ]);
      // Wiki + Forum = 5 GB; the total is unchanged by folding.
      expect(within(legend()).getAllByRole("button")).toHaveLength(4);
      expect(item(/^2 otras/)).toHaveTextContent("5.00 GB");
      expect(within(legend()).queryByText(/\(\d+\)/)).not.toBeInTheDocument();
      expect(within(centerOf(container)).getByText("40.00 GB")).toBeInTheDocument();
      expect(screen.queryByText("Wiki")).not.toBeInTheDocument();
    });

    // The size follows the label with no space between them in the text, hence the lookahead.
    it.each([
      ["es", /^1 otra(?!s)/],
      ["en", /^1 other(?!s)/],
    ])("names a single folded connection in the singular, in %s", async (language, singular) => {
      mockStorage({ data: fiveConnections().slice(0, 4) });
      const previous = i18n.language;
      await i18n.changeLanguage(language);
      try {
        render(<StorageByConnectionChart />);

        const buttons = within(screen.getByRole("group", { name: language === "es" ? "Leyenda" : "Legend" }))
          .getAllByRole("button");
        expect(buttons).toHaveLength(4);
        expect(buttons[3]).toHaveTextContent(singular);
        expect(buttons[3]).toHaveTextContent("3.00 GB");
      } finally {
        cleanup();
        await i18n.changeLanguage(previous);
      }
    });

    it("has a hole, so the center can carry the total", () => {
      mockStorage({ data: threeConnections() });

      const { container } = render(<StorageByConnectionChart />);

      // A donut slice path has an inner arc: two arcs, not one wedge to the center.
      const slice = container.querySelector("svg path[fill='var(--chart-1)']");
      expect((slice?.getAttribute("d")?.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("legend", () => {
    it("lists every slice with its size and its share of the total", () => {
      mockStorage({ data: threeConnections() });

      render(<StorageByConnectionChart />);

      expect(item(/Shop/)).toHaveTextContent("27.00 GB");
      expect(item(/Shop/)).toHaveTextContent("60%");
      expect(item(/CRM/)).toHaveTextContent("13.50 GB");
      expect(item(/CRM/)).toHaveTextContent("30%");
      expect(item(/Blog/)).toHaveTextContent("4.50 GB");
      expect(item(/Blog/)).toHaveTextContent("10%");
    });

    it("names a connection whose record is gone instead of leaving a blank", () => {
      mockStorage({ data: [row("a", null, 10 * GB), row("b", "CRM", 5 * GB)] });

      render(<StorageByConnectionChart />);

      expect(item(/Conexión eliminada/)).toHaveTextContent("10.00 GB");
    });

    it("keeps two connections with the same name as two entries", () => {
      mockStorage({ data: [row("a", "Prod", 10 * GB), row("b", "Prod", 5 * GB)] });

      render(<StorageByConnectionChart />);

      expect(within(legend()).getAllByRole("button", { name: /Prod/ })).toHaveLength(2);
    });

    it("links the legend to the donut on hover: the center names the item", async () => {
      mockStorage({ data: threeConnections() });
      const user = userEvent.setup();

      const { container } = render(<StorageByConnectionChart />);
      await user.hover(item(/CRM/));

      await waitFor(() => {
        expect(within(centerOf(container)).getByText("CRM")).toBeInTheDocument();
      });
      expect(within(centerOf(container)).getByText("13.50 GB")).toBeInTheDocument();
      expect(within(centerOf(container)).queryByText("Total")).not.toBeInTheDocument();

      await user.unhover(item(/CRM/));

      await waitFor(() => {
        expect(within(centerOf(container)).getByText("Total")).toBeInTheDocument();
      });
    });

    it("links the donut to the legend on hover: the slice's item lights up", async () => {
      mockStorage({ data: threeConnections() });

      const { container } = render(<StorageByConnectionChart />);

      fireEvent.mouseEnter(hitArea(container, 2));

      await waitFor(() => {
        expect(item(/Blog/)).toHaveAttribute("data-hovered");
      });
      expect(item(/Shop/)).not.toHaveAttribute("data-hovered");
      expect(within(centerOf(container)).getByText("Blog")).toBeInTheDocument();

      fireEvent.mouseLeave(hitArea(container, 2));

      await waitFor(() => {
        expect(item(/Blog/)).not.toHaveAttribute("data-hovered");
      });
    });

    it("pins an item on tap or click, and unpins it on the second", async () => {
      mockStorage({ data: threeConnections() });
      const user = userEvent.setup();

      const { container } = render(<StorageByConnectionChart />);
      const crm = item(/CRM/);
      expect(crm).toHaveAttribute("aria-pressed", "false");

      await user.click(crm);

      expect(crm).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(within(centerOf(container)).getByText("CRM")).toBeInTheDocument();
      });

      // The pointer is still on the item; the second click must still reset it.
      await user.click(crm);

      expect(crm).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => {
        expect(within(centerOf(container)).getByText("Total")).toBeInTheDocument();
      });
    });

    it("works from the keyboard", async () => {
      mockStorage({ data: threeConnections() });
      const user = userEvent.setup();

      render(<StorageByConnectionChart />);
      const shop = item(/Shop/);
      shop.focus();

      await user.keyboard("{Enter}");
      expect(shop).toHaveAttribute("aria-pressed", "true");

      await user.keyboard(" ");
      expect(shop).toHaveAttribute("aria-pressed", "false");
    });

    it("reacts to taps only on a touch screen, not to the emulated hover", async () => {
      stubMedia({ canHover: false });
      mockStorage({ data: threeConnections() });
      const user = userEvent.setup();

      const { container } = render(<StorageByConnectionChart />);
      await user.hover(item(/CRM/));

      // A tap fires mouse events with no mouseleave after: hover must not stick.
      expect(within(centerOf(container)).getByText("Total")).toBeInTheDocument();
      expect(item(/CRM/)).not.toHaveAttribute("data-hovered");

      await user.click(item(/CRM/));

      expect(item(/CRM/)).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(within(centerOf(container)).getByText("CRM")).toBeInTheDocument();
      });
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading, without a chart", () => {
      mockStorage({ isLoading: true });

      render(<StorageByConnectionChart />);

      expect(
        screen.getByRole("status", { name: "Cargando almacenamiento por conexión" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("keeps the donut's place with an empty ring and one line where the legend goes", () => {
      mockStorage({ data: [] });

      const { container } = render(<StorageByConnectionChart />);

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      const ring = screen.getByTestId("storage-empty-ring");
      // The ring of the loading state, standing still: the size of the drawn donut, and no data color.
      expect(ring).toHaveClass("rounded-full", "border-[26px]", "border-muted");
      expect(ring).not.toHaveClass("animate-pulse");
      expect(ring).toHaveStyle({ width: "176px", height: "176px" });
      expect(container.querySelector("[fill^='var(--chart-'], [style*='--chart-']")).toBeNull();
      const empty = screen.getByTestId("card-empty");
      expect(within(empty).getByText("Aún no hay respaldos almacenados")).toBeInTheDocument();
      // As tall as the three legend rows of the loading state.
      expect(empty).toHaveClass("min-h-[8.25rem]");
    });

    it("treats connections with nothing stored as empty", () => {
      mockStorage({ data: [row("a", "Shop", 0)] });

      render(<StorageByConnectionChart />);

      expect(screen.getByText("Aún no hay respaldos almacenados")).toBeInTheDocument();
      expect(screen.getByTestId("storage-empty-ring")).toBeInTheDocument();
    });

    it("shows the error with its reason and retries on request", async () => {
      const refetch = vi.fn();
      mockStorage({ isError: true, error: new Error("boom"), refetch });
      const user = userEvent.setup();

      render(<StorageByConnectionChart />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo cargar el almacenamiento por conexión: boom",
      );
      expect(screen.queryByRole("img")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to a generic reason when the error has no message", () => {
      mockStorage({ isError: true, error: null });

      render(<StorageByConnectionChart />);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo cargar el almacenamiento por conexión: Error desconocido",
      );
    });
  });
});
