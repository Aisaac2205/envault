import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardHeader } from "../DashboardHeader";
import type { DashboardHeadline } from "../../lib/derive-headline";

const headline: DashboardHeadline = {
  tone: "ok",
  connectionName: "prod-db",
  at: new Date(Date.now() - 5 * 60_000).toISOString(),
  nextRun: null,
};

describe("DashboardHeader", () => {
  it("renders the page title as an h1 and the status line", () => {
    render(<DashboardHeader headline={headline} updatedAt={Date.now()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Último respaldo completado")).toBeInTheDocument();
  });

  it("renders a static HH:MM:SS freshness label with no spinner when updatedAt is set", () => {
    const fixed = new Date("2026-09-01T14:32:05.000Z").getTime();
    render(<DashboardHeader headline={headline} updatedAt={fixed} />);

    expect(screen.getByText(/Actualizado \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders no freshness label when updatedAt is null", () => {
    render(<DashboardHeader headline={headline} updatedAt={null} />);

    expect(screen.queryByText(/Actualizado/)).not.toBeInTheDocument();
  });
});
