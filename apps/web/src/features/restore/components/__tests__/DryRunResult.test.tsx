import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DryRunResult } from "../DryRunResult";
import type { DryRunResult as DryRunResultType } from "../../types";

const LONG_TABLE = "customer_subscription_billing_events_archive_2026";

const targetConnection = {
  name: "Orders QA",
  database: "orders_qa",
  environment: "qa",
  dbType: "postgres",
};

const withManifest: DryRunResultType = {
  manifestAvailable: true,
  sourceConnection: {
    name: "Orders",
    database: "orders",
    environment: "prod",
    dbType: "postgres",
  },
  targetConnection,
  source: {
    tableCount: 2,
    estimatedRows: 1_234_567,
    tables: [
      { name: "users", estimatedRows: 1_200_000 },
      { name: LONG_TABLE, estimatedRows: 34_567 },
    ],
  },
  target: {
    tableCount: 1,
    estimatedRows: 1_000_000,
    tables: [{ name: "users", estimatedRows: 1_000_000 }],
  },
  diff: {
    added: [LONG_TABLE],
    removed: [],
    common: [{ name: "users", sourceRows: 1_200_000, targetRows: 1_000_000 }],
  },
};

const targetOnly: DryRunResultType = {
  manifestAvailable: false,
  targetConnection,
  source: null,
  diff: null,
  target: {
    tableCount: 1,
    estimatedRows: 1_000_000,
    tables: [{ name: LONG_TABLE, estimatedRows: 1_000_000 }],
  },
};

function renderResult(result: DryRunResultType) {
  render(
    <DryRunResult
      result={result}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      isLoading={false}
    />,
  );
}

describe("DryRunResult: table comparison scroll region", () => {
  // Roselli's under-engineered responsive table: the scroller is a named,
  // focusable region so keyboard users can scroll it on a phone.
  it("exposes the comparison table in a named, focusable region", () => {
    renderResult(withManifest);

    const region = screen.getByRole("region", { name: "Comparación de tablas" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("focus-visible:ring-2");
    expect(
      within(region).getByRole("table", { name: "Comparación de tablas" }),
    ).toBeInTheDocument();
  });

  it("reaches the region with the keyboard before the table controls", async () => {
    const user = userEvent.setup();
    renderResult(withManifest);

    await user.tab();

    expect(screen.getByRole("region", { name: "Comparación de tablas" })).toHaveFocus();
  });

  it("lets long table names wrap instead of widening the table", () => {
    renderResult(withManifest);

    const nameCell = screen.getByText(LONG_TABLE).closest("td");
    expect(nameCell).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("stacks the footer below sm with the confirm action on top", () => {
    renderResult(withManifest);

    const confirm = screen.getByRole("button", { name: "Confirmar restauración" });
    const actions = confirm.parentElement;
    const footer = actions?.parentElement;

    expect(actions).toHaveClass("flex", "flex-col-reverse", "sm:flex-row");
    expect(footer).toHaveClass("flex", "flex-col", "sm:flex-row", "sm:justify-between");
  });

  it("stacks the source and target summaries below sm", () => {
    renderResult(withManifest);

    const summaries = screen.getByText("2 tablas, ~1.234.567 filas").closest("div")?.parentElement;
    expect(summaries).toHaveClass("flex", "flex-col", "sm:flex-row");
  });
});

describe("DryRunResult: comparison cards on phones", () => {
  // Below 42rem of table room each compared table becomes a card, the same
  // layout as the app's other tables: the name as title with the difference
  // and the exclude control beside it, then one labelled line per side.
  function rowOf(name: string) {
    return screen.getByText(name).closest("tr") as HTMLElement;
  }

  it("reflows by the room of the card around it, not the scroller's, into a stack of cards below 42rem", () => {
    renderResult(withManifest);

    const region = screen.getByRole("region", { name: "Comparación de tablas" });
    // The result card is the container (see the restore page); a container here would be narrower.
    expect(region.parentElement).not.toHaveClass("@container/table");
    const table = within(region).getByRole("table");
    expect(table).toHaveClass("@max-2xl/table:block");
    expect(table.querySelector("thead")).toHaveClass("@max-2xl/table:sr-only");
    expect(table.querySelector("tbody")).toHaveClass("@max-2xl/table:block");
    expect(rowOf("users")).toHaveClass("@max-2xl/table:flex", "@max-2xl/table:flex-wrap");
  });

  it("titles each card with the table name, the difference as its badge and the exclude control at the end", () => {
    renderResult(withManifest);
    const row = rowOf("users");

    expect(within(row).getByText("users").closest("td")).toHaveClass("@max-2xl/table:order-1", "@max-2xl/table:flex-1");
    expect(within(row).getByText("+200.000").closest("td")).toHaveClass("@max-2xl/table:order-2");
    const exclude = within(row).getByRole("button", { name: "Excluir tabla users" });
    expect(exclude.closest("td")).toHaveClass("@max-2xl/table:order-3");
    // No row link to sit above, and a raised cell would scroll over the sticky header.
    expect(exclude.closest("td")).not.toHaveClass("z-10");
    // A 20 px box with a 44 px tap area in a card.
    expect(exclude).toHaveClass("relative", "@max-2xl/table:after:absolute", "@max-2xl/table:after:-inset-[13px]");
  });

  it("labels the source and target counts with their side and environment", () => {
    renderResult(withManifest);
    const row = rowOf("users");

    const source = within(row).getByText("1.200.000").closest("td") as HTMLElement;
    const target = within(row).getByText("1.000.000").closest("td") as HTMLElement;
    expect(source).toHaveClass("@max-2xl/table:order-6", "@max-2xl/table:basis-full");
    expect(target).toHaveClass("@max-2xl/table:order-6");
    expect(within(source).getByText("Origen · PROD")).toHaveAttribute("aria-hidden", "true");
    expect(within(target).getByText("Destino · QA")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a new table's status as the card badge", () => {
    renderResult(withManifest);

    expect(screen.getByText("Nueva").closest("td")).toHaveClass("@max-2xl/table:order-2");
  });

  it("keeps excluding tables: the row fades and the footer counts it", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DryRunResult result={withManifest} onConfirm={onConfirm} onCancel={vi.fn()} isLoading={false} />);

    await user.click(screen.getByRole("button", { name: "Excluir tabla users" }));

    expect(rowOf("users")).toHaveClass("opacity-40");
    await user.click(screen.getByRole("button", { name: "Confirmar restauración" }));
    expect(onConfirm).toHaveBeenCalledWith(["users"]);
  });
});

describe("DryRunResult: target-only view", () => {
  it("exposes the target tables in a named, focusable region", () => {
    renderResult(targetOnly);

    const region = screen.getByRole("region", { name: "Destino actual" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("focus-visible:ring-2");
    expect(within(region).getByRole("table", { name: "Destino actual" })).toBeInTheDocument();
    expect(screen.getByText(LONG_TABLE).closest("td")).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("stacks the footer below sm with the confirm action on top", () => {
    renderResult(targetOnly);

    const actions = screen.getByRole("button", { name: "Confirmar restauración" }).parentElement;
    expect(actions).toHaveClass("flex", "flex-col-reverse", "sm:flex-row", "sm:justify-end");
  });
});

describe("DryRunResult: connection cards on phones", () => {
  // Below sm the cards share one minmax(0, 1fr) column so a long name cannot
  // widen them past the result card; names wrap there and truncate from sm.
  it("keeps the cards inside one shrinkable column and wraps long names below sm", () => {
    renderResult(withManifest);

    const name = screen.getByText("Orders QA");
    const card = name.parentElement?.parentElement;
    expect(card?.parentElement).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2");
    expect(name).toHaveClass("[overflow-wrap:anywhere]", "sm:truncate");
    expect(name).not.toHaveClass("truncate");
    expect(screen.getByText("orders_qa")).toHaveClass("[overflow-wrap:anywhere]", "sm:truncate");
  });
});

describe("DryRunResult: horizontal scroll hint", () => {
  // jsdom has no layout, so the scroller's geometry is stubbed and a scroll
  // event drives the same measurement the browser does.
  function stubGeometry(el: HTMLElement, geometry: { clientWidth: number; scrollWidth: number; scrollLeft: number }) {
    for (const [key, value] of Object.entries(geometry)) {
      Object.defineProperty(el, key, { configurable: true, value });
    }
    fireEvent.scroll(el);
  }

  function fades(region: HTMLElement) {
    const wrapper = region.parentElement as HTMLElement;
    return {
      start: wrapper.querySelector('[data-scroll-fade="start"]'),
      end: wrapper.querySelector('[data-scroll-fade="end"]'),
    };
  }

  it("fades the edge that still has columns to scroll to", () => {
    renderResult(withManifest);
    const region = screen.getByRole("region", { name: "Comparación de tablas" });

    stubGeometry(region, { clientWidth: 294, scrollWidth: 464, scrollLeft: 0 });
    expect(fades(region).start).toHaveAttribute("data-visible", "false");
    expect(fades(region).end).toHaveAttribute("data-visible", "true");

    stubGeometry(region, { clientWidth: 294, scrollWidth: 464, scrollLeft: 80 });
    expect(fades(region).start).toHaveAttribute("data-visible", "true");
    expect(fades(region).end).toHaveAttribute("data-visible", "true");

    stubGeometry(region, { clientWidth: 294, scrollWidth: 464, scrollLeft: 170 });
    expect(fades(region).start).toHaveAttribute("data-visible", "true");
    expect(fades(region).end).toHaveAttribute("data-visible", "false");
  });

  it("shows no fade when the table fits", () => {
    renderResult(withManifest);
    const region = screen.getByRole("region", { name: "Comparación de tablas" });

    stubGeometry(region, { clientWidth: 1102, scrollWidth: 1102, scrollLeft: 0 });

    expect(fades(region).start).toHaveAttribute("data-visible", "false");
    expect(fades(region).end).toHaveAttribute("data-visible", "false");
    expect(fades(region).end).toHaveAttribute("aria-hidden", "true");
  });

  it("gives the target-only table the same hint", () => {
    renderResult(targetOnly);
    const region = screen.getByRole("region", { name: "Destino actual" });

    stubGeometry(region, { clientWidth: 294, scrollWidth: 400, scrollLeft: 0 });

    expect(fades(region).end).toHaveAttribute("data-visible", "true");
  });
});
