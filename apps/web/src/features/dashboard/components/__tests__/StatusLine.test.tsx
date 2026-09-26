import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusLine } from "../StatusLine";
import type { DashboardHeadline } from "../../lib/derive-headline";

function headline(overrides: Partial<DashboardHeadline>): DashboardHeadline {
  return {
    tone: "ok",
    connectionName: "prod-db",
    at: new Date(Date.now() - 5 * 60_000).toISOString(),
    nextRun: null,
    ...overrides,
  };
}

describe("StatusLine", () => {
  it("renders the tone text inside an aria-live=polite region", () => {
    render(<StatusLine headline={headline({ tone: "ok" })} />);

    const live = screen.getByText("Último respaldo completado");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("renders the failed tone text and connection name", () => {
    render(<StatusLine headline={headline({ tone: "failed", connectionName: "stg-db" })} />);

    expect(screen.getByText("El último respaldo falló")).toBeInTheDocument();
    expect(screen.getByText(/stg-db/)).toBeInTheDocument();
  });

  it("renders the none tone with no connection and no crash when at/nextRun are null", () => {
    render(<StatusLine headline={headline({ tone: "none", connectionName: null, at: null, nextRun: null })} />);

    expect(screen.getByText("Aún no hay respaldos")).toBeInTheDocument();
  });

  it("renders the next run name when present", () => {
    const future = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    render(
      <StatusLine
        headline={headline({ tone: "ok", nextRun: { name: "nightly", at: future } })}
      />,
    );

    expect(screen.getByText(/nightly/)).toBeInTheDocument();
  });

  it("does not re-mutate the live region's text when only the connection changes for the same tone", () => {
    const { rerender } = render(<StatusLine headline={headline({ tone: "ok", connectionName: "prod-db" })} />);
    const before = screen.getByText("Último respaldo completado");

    rerender(<StatusLine headline={headline({ tone: "ok", connectionName: "stg-db" })} />);
    const after = screen.getByText("Último respaldo completado");

    expect(after.textContent).toBe(before.textContent);
    expect(screen.getByText(/stg-db/)).toBeInTheDocument();
  });
});
