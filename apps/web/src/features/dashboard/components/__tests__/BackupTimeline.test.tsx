import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BackupTimeline } from "../BackupTimeline";
import type { BackupJob } from "../../types";

// Mock useConnections for ConnectionLabel usage
vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Prod DB", environment: "prod" },
      { id: "conn-2", name: "Dev DB", environment: "dev" },
    ],
    isLoading: false,
  }),
}));

const mockBackups: BackupJob[] = [
  {
    id: "backup-1",
    connectionId: "conn-1",
    connectionName: "Prod DB",
    environment: "prod",
    status: "completed",
    fileKey: "backups/backup-1.dump",
    fileSizeMb: 42.5,
    startedAt: "2026-06-13T02:00:00Z",
    completedAt: "2026-06-13T02:15:00Z",
    errorMessage: null,
    triggeredBy: "cron",
    createdAt: "2026-06-13T02:15:00Z",
  },
  {
    id: "backup-2",
    connectionId: "conn-2",
    connectionName: "Dev DB",
    environment: "dev",
    status: "failed",
    fileKey: null,
    fileSizeMb: null,
    startedAt: "2026-06-13T03:00:00Z",
    completedAt: null,
    errorMessage: "Connection refused",
    triggeredBy: "cron",
    createdAt: "2026-06-13T03:00:00Z",
  },
];

describe("BackupTimeline", () => {
  function renderTimeline(backups = mockBackups, maxItems = 15) {
    return render(
      <MemoryRouter>
        <BackupTimeline backups={backups} maxItems={maxItems} />
      </MemoryRouter>,
    );
  }

  it("renders Entorno column header", () => {
    renderTimeline();
    expect(screen.getByText("Entorno")).toBeInTheDocument();
  });

  it("renders environment as clean formatted text", () => {
    renderTimeline();

    expect(screen.getByText("Producción")).toBeInTheDocument();
    expect(screen.getByText("Desarrollo")).toBeInTheDocument();
  });

  it("uses muted-foreground styling for environment", () => {
    renderTimeline();

    const prodElement = screen.getByText("Producción");
    expect(prodElement.classList.contains("text-muted-foreground")).toBe(true);
  });

  it("renders connection names without environment badge", () => {
    renderTimeline();

    // Connection names should still render
    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("Dev DB")).toBeInTheDocument();

    // No EnvironmentBadge border elements
    const badges = document.querySelectorAll(".border-destructive\\/40");
    expect(badges.length).toBe(0);
  });

  it("renders status indicators", () => {
    renderTimeline();

    // Status dot elements - at minimum the two backup status dots
    const statusDots = document.querySelectorAll(".rounded-full");
    expect(statusDots.length).toBeGreaterThanOrEqual(2);
  });

  it("shows remaining count when over maxItems", () => {
    const manyBackups = Array.from({ length: 20 }, (_, i) => ({
      ...mockBackups[0],
      id: `backup-${i}`,
    }));
    renderTimeline(manyBackups, 15);
    expect(screen.getByText("+5 más")).toBeInTheDocument();
  });

  it("renders empty state when no backups", () => {
    renderTimeline([]);
    expect(screen.getByText(/Sin respaldos recientes/i)).toBeInTheDocument();
  });
});
