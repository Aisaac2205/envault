import { describe, it, expect } from "vitest";
import { deriveHeadline } from "../derive-headline";
import type { BackupJob, CronjobEntity } from "../../types";

function backup(overrides: Partial<BackupJob>): BackupJob {
  return {
    id: "b1",
    connectionId: "c1",
    connectionName: "prod-db",
    environment: "production",
    status: "completed",
    fileKey: null,
    fileSizeMb: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    triggeredBy: "schedule",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function cronjob(overrides: Partial<CronjobEntity>): CronjobEntity {
  return {
    id: "cj1",
    name: "nightly",
    isActive: true,
    cronExpression: "0 3 * * *",
    connectionId: "c1",
    connectionName: "prod-db",
    nextRunAt: "2026-09-02T03:00:00.000Z",
    lastRunAt: null,
    lastStatus: null,
    ...overrides,
  };
}

describe("deriveHeadline", () => {
  it("returns tone ok with connection and completion time for a completed latest backup", () => {
    const headline = deriveHeadline(
      [backup({ status: "completed", completedAt: "2026-09-01T12:00:00.000Z", createdAt: "2026-09-01T11:58:00.000Z" })],
      [],
    );

    expect(headline.tone).toBe("ok");
    expect(headline.connectionName).toBe("prod-db");
    expect(headline.at).toBe("2026-09-01T12:00:00.000Z");
  });

  it("returns tone failed for a failed latest backup", () => {
    const headline = deriveHeadline(
      [backup({ status: "failed", completedAt: "2026-09-01T12:00:00.000Z" })],
      [],
    );

    expect(headline.tone).toBe("failed");
  });

  it("returns tone running for a running latest backup, using startedAt when not yet completed", () => {
    const headline = deriveHeadline(
      [backup({ status: "running", startedAt: "2026-09-01T12:00:00.000Z", completedAt: null })],
      [],
    );

    expect(headline.tone).toBe("running");
    expect(headline.at).toBe("2026-09-01T12:00:00.000Z");
  });

  it("returns tone running for a pending latest backup", () => {
    const headline = deriveHeadline(
      [backup({ status: "pending", startedAt: null, completedAt: null, createdAt: "2026-09-01T12:00:00.000Z" })],
      [],
    );

    expect(headline.tone).toBe("running");
    expect(headline.at).toBe("2026-09-01T12:00:00.000Z");
  });

  it("returns tone none, null connection and null at for an empty backups list", () => {
    const headline = deriveHeadline([], []);

    expect(headline.tone).toBe("none");
    expect(headline.connectionName).toBeNull();
    expect(headline.at).toBeNull();
  });

  it("returns a null nextRun when there are no active cronjobs with a scheduled next run", () => {
    const headline = deriveHeadline(
      [backup({ status: "completed" })],
      [cronjob({ isActive: false }), cronjob({ isActive: true, nextRunAt: null })],
    );

    expect(headline.nextRun).toBeNull();
  });

  it("picks the soonest active cronjob's next run", () => {
    const headline = deriveHeadline(
      [backup({ status: "completed" })],
      [
        cronjob({ id: "later", name: "weekly", nextRunAt: "2026-09-05T00:00:00.000Z" }),
        cronjob({ id: "sooner", name: "nightly", nextRunAt: "2026-09-02T00:00:00.000Z" }),
      ],
    );

    expect(headline.nextRun).toEqual({ name: "nightly", at: "2026-09-02T00:00:00.000Z" });
  });

  it("sorts backups defensively by createdAt so the newest wins even if the input is not pre-sorted", () => {
    const headline = deriveHeadline(
      [
        backup({ id: "old", status: "completed", createdAt: "2026-09-01T00:00:00.000Z", connectionName: "old-db" }),
        backup({ id: "new", status: "failed", createdAt: "2026-09-02T00:00:00.000Z", connectionName: "new-db" }),
      ],
      [],
    );

    expect(headline.tone).toBe("failed");
    expect(headline.connectionName).toBe("new-db");
  });
});
