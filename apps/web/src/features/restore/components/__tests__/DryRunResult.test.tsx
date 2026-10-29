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
