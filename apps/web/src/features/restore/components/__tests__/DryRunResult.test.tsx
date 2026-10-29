import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
