import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BackupActivity } from "../BackupActivity";
import type { BackupJob } from "../../../types";

const backups: BackupJob[] = [
  {
    id: "backup-1",
    connectionId: "c1",
    connectionName: "prod-db",
    environment: "production",
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
    connectionId: "c2",
    connectionName: "stg-db",
    environment: "staging",
    status: "failed",
    fileKey: null,
    fileSizeMb: null,
    startedAt: "2026-06-13T03:00:00Z",
    completedAt: null,
    errorMessage: "Connection refused after 300s timeout waiting for the upstream database to respond",
    triggeredBy: "cron",
    createdAt: "2026-06-13T03:00:00Z",
  },
];

describe("BackupActivity", () => {
  it("renders the run strip summary and each row with its connection and size", () => {
    render(<BackupActivity backups={backups} />);

    expect(screen.getByText("Últimas 2 ejecuciones: 1 completadas, 1 fallidas")).toBeInTheDocument();
    expect(screen.getByText("prod-db")).toBeInTheDocument();
    expect(screen.getByText("stg-db")).toBeInTheDocument();
    expect(screen.getByText("42.5 MB")).toBeInTheDocument();
  });

  it("shows a truncated error message on the failed row with the full text in its title attribute", () => {
    render(<BackupActivity backups={backups} />);

    const errorText = "Connection refused after 300s timeout waiting for the upstream database to respond";
    const errorEl = screen.getByTitle(errorText);
    expect(errorEl).toHaveTextContent(errorText);
    expect(errorEl.className).toContain("truncate");
  });

  it("shows a dash for a row with no recorded file size", () => {
    render(<BackupActivity backups={backups} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("caps visible rows at maxItems while the run strip still reflects up to 15 runs", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...backups[0], id: `b${i}` }));
    render(<BackupActivity backups={many} maxItems={3} />);

    expect(screen.getAllByText("prod-db")).toHaveLength(3);
  });
});
