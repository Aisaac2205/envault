import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CronjobsTable from "../CronjobsTable";
import type { Cronjob } from "../../types";

// Mock useConnections to return test connection data
vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Prod DB", environment: "prod", dbType: "postgres" },
      { id: "conn-2", name: "Dev DB", environment: "dev", dbType: "mysql" },
      { id: "conn-3", name: "QA DB", environment: "qa" },
    ],
    isLoading: false,
  }),
}));

const mockCronjobs = [
  {
    id: "cj-1",
    name: "Daily Backup",
    connectionId: "conn-1",
    connectionName: "Prod DB",
    schedule: { kind: "daily" as const, time: "02:00" },
    isActive: true,
    lastRunAt: "2026-06-13T02:00:00Z",
    nextRunAt: "2026-06-14T02:00:00Z",
    lastStatus: "completed" as const,
  },
  {
    id: "cj-2",
    name: "Dev Snapshot",
    connectionId: "conn-2",
    connectionName: "Dev DB",
    schedule: { kind: "every_hours" as const, everyHours: 6 as const },
    isActive: false,
    nextRunAt: "2026-06-13T18:00:00Z",
    lastStatus: undefined,
  },
];

describe("CronjobsTable", () => {
  const defaultProps = {
    cronjobs: mockCronjobs,
    isLoading: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onToggle: vi.fn(),
    toggleLoading: {} as Record<string, boolean>,
  };

  it("renders Entorno column header", () => {
    render(<CronjobsTable {...defaultProps} />);
    expect(screen.getByText("Entorno")).toBeInTheDocument();
  });

  it("renders environment as clean formatted text for each row", () => {
    render(<CronjobsTable {...defaultProps} />);

    expect(screen.getByText("Producción")).toBeInTheDocument();
    expect(screen.getByText("Desarrollo")).toBeInTheDocument();
  });

  it("renders hyphen for unknown connection", () => {
    const cronjobs = [
      {
        ...mockCronjobs[0],
        connectionId: "nonexistent",
      },
    ];
    render(<CronjobsTable {...defaultProps} cronjobs={cronjobs} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("does not render EnvironmentBadge in the connection column", () => {
    render(<CronjobsTable {...defaultProps} />);
    // EnvironmentBadge used border-destructive/40 for prod items — verify absent
    const badgeElements = document.querySelectorAll(".border-destructive\\/40");
    expect(badgeElements.length).toBe(0);
  });

  it("removes showEnv from ConnectionLabel usage", () => {
    render(<CronjobsTable {...defaultProps} />);
    // Connection names should still render
    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("Dev DB")).toBeInTheDocument();
  });

  it("renders Entorno column in table header", () => {
    render(<CronjobsTable {...defaultProps} />);
    // The header should still show Entorno
    expect(screen.getByText("Entorno")).toBeInTheDocument();
  });

  it("renders the schedule column header", () => {
    render(<CronjobsTable {...defaultProps} />);
    expect(screen.getByText("Programación")).toBeInTheDocument();
    expect(screen.queryByText(/cron/i)).not.toBeInTheDocument();
  });

  it("describes each schedule in plain language", () => {
    render(<CronjobsTable {...defaultProps} />);
    expect(screen.getByText("Todos los días a las 02:00")).toBeInTheDocument();
    expect(screen.getByText("Cada 6 horas")).toBeInTheDocument();
  });

  it("keeps the schedule column hidden on small screens", () => {
    render(<CronjobsTable {...defaultProps} />);
    const header = screen.getByText("Programación").closest("th");
    const cell = screen.getByText("Todos los días a las 02:00").closest("td");
    for (const element of [header, cell]) {
      expect(element).toHaveClass("hidden", "sm:table-cell");
    }
  });

  it("shows a generic label for a schedule the builder cannot represent", () => {
    const legacy: Cronjob[] = [{ ...mockCronjobs[0], schedule: null }];
    render(<CronjobsTable {...defaultProps} cronjobs={legacy} />);
    expect(screen.getByText("Programación personalizada")).toBeInTheDocument();
  });

  it("never renders the raw cron expression the API still sends", () => {
    const legacy: Cronjob = { ...mockCronjobs[0], schedule: null };
    // The API still sends the expression; the type no longer knows about it.
    const withExpression = { ...legacy, cronExpression: "*/7 3-5 * * 2,4" };
    const { container } = render(
      <CronjobsTable {...defaultProps} cronjobs={[withExpression]} />,
    );
    expect(container.textContent).not.toContain("*/7");
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("leads each connection name with the official logo of its engine", () => {
    render(<CronjobsTable {...defaultProps} />);

    const postgres = screen.getByRole("img", { name: "PostgreSQL" });
    expect(postgres.closest("td")).toBe(screen.getByText("Prod DB").closest("td"));
    expect(screen.getByRole("img", { name: "MySQL" }).closest("td")).toBe(screen.getByText("Dev DB").closest("td"));
  });

  it("keeps the connection name alone when its engine is unknown", () => {
    const cronjobs = [{ ...mockCronjobs[0], connectionId: "conn-3", connectionName: "QA DB" }];
    render(<CronjobsTable {...defaultProps} cronjobs={cronjobs} />);

    expect(screen.getByText("QA DB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders empty state when no cronjobs", () => {
    render(<CronjobsTable {...defaultProps} cronjobs={[]} />);
    expect(screen.getByText(/No hay cronjobs/i)).toBeInTheDocument();
  });
});
