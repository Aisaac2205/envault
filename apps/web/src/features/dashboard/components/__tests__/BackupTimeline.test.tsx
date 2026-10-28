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

  it("has no environment column, since only production connections are backed up", () => {
    renderTimeline();

    expect(screen.queryByRole("columnheader", { name: "Entorno" })).not.toBeInTheDocument();
    expect(screen.queryByText("Producción")).not.toBeInTheDocument();
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

  describe("recent backups card", () => {
    const eightBackups = Array.from({ length: 8 }, (_, i) => ({
      ...mockBackups[0]!,
      id: `backup-${i}`,
      connectionName: `Conexión ${i}`,
    }));

    it("has a real heading", () => {
      renderTimeline();

      expect(
        screen.getByRole("heading", { level: 2, name: "Últimos respaldos" }),
      ).toBeInTheDocument();
    });

    it("shows five rows by default and says how many more there are", () => {
      render(
        <MemoryRouter>
          <BackupTimeline backups={eightBackups} />
        </MemoryRouter>,
      );

      // One header row plus five backups.
      expect(screen.getAllByRole("row")).toHaveLength(6);
      expect(screen.getByText("Conexión 4")).toBeInTheDocument();
      expect(screen.queryByText("Conexión 5")).not.toBeInTheDocument();
      expect(screen.getByText("+3 más")).toBeInTheDocument();
    });

    it("keeps its columns", () => {
      renderTimeline();

      for (const header of ["Conexión", "Estado", "Fecha"]) {
        expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
      }
    });

    it("scrolls a wide table inside the card, not the page", () => {
      const { container } = renderTimeline();

      // The card may shrink below the table's width (min-w-0), and the table sits in
      // an overflow-x-auto wrapper, so a narrow screen scrolls the table, not the page.
      const card = container.firstElementChild as HTMLElement;
      expect(card).toHaveClass("min-w-0");
      expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    });
  });

  it("renders empty state when no backups", () => {
    renderTimeline([]);
    expect(screen.getByText(/Sin respaldos recientes/i)).toBeInTheDocument();
  });
});
