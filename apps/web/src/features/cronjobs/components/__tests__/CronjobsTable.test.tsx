import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CronjobsTable from "../CronjobsTable";

// Mock useConnections to return test connection data
vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Prod DB", environment: "prod" },
      { id: "conn-2", name: "Dev DB", environment: "dev" },
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
    cronExpression: "0 2 * * *",
    frequency: "daily" as const,
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
    cronExpression: "0 */6 * * *",
    frequency: "daily" as const,
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

  it("renders empty state when no cronjobs", () => {
    render(<CronjobsTable {...defaultProps} cronjobs={[]} />);
    expect(screen.getByText(/No hay cronjobs/i)).toBeInTheDocument();
  });
});
