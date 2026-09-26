import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunStrip } from "../RunStrip";
import type { BackupJob } from "../../../types";

function backup(status: BackupJob["status"], id: string): BackupJob {
  return {
    id,
    connectionId: "c1",
    connectionName: "prod-db",
    environment: "production",
    status,
    fileKey: null,
    fileSizeMb: 10,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    triggeredBy: "schedule",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("RunStrip", () => {
  it("shows at most 15 status cells and a text summary matching those visible counts", () => {
    const backups = Array.from({ length: 20 }, (_, i) =>
      backup(i < 13 ? "completed" : "failed", `b${i}`),
    );

    const { container } = render(<RunStrip backups={backups} />);

    expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(15);
    // First 15: 13 completed + 2 failed (indices 13, 14 are failed; 15-19 excluded).
    expect(screen.getByText("Últimas 15 ejecuciones: 13 completadas, 2 fallidas")).toBeInTheDocument();
  });

  it("matches the full count when there are fewer than 15 runs", () => {
    const backups = [backup("completed", "a"), backup("failed", "b")];
    render(<RunStrip backups={backups} />);

    expect(screen.getByText("Últimas 2 ejecuciones: 1 completadas, 1 fallidas")).toBeInTheDocument();
  });
});
