import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BackupJob } from "../../types";
import { BackupTimeline } from "../BackupTimeline";
import { formatCompactDateTime } from "../compact-date";
import { useEnglishLocale } from "./english-locale";

vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({ data: [{ id: "conn-1", name: "Prod DB", environment: "prod" }], isLoading: false }),
}));

function job(createdAt: string): BackupJob {
  return {
    id: "backup-1",
    connectionId: "conn-1",
    connectionName: "Prod DB",
    environment: "prod",
    status: "completed",
    fileKey: "k",
    fileSizeMb: 1,
    startedAt: createdAt,
    completedAt: createdAt,
    errorMessage: null,
    triggeredBy: "cron",
    createdAt,
  };
}

describe("formatCompactDateTime", () => {
  const now = new Date(2026, 9, 28, 12, 0);

  it("is the day, the short month and the time, without the year, in the language", () => {
    const date = new Date(2026, 9, 28, 14, 5);

    expect(formatCompactDateTime(date, "es-AR", now)).toMatch(/^28 oct,? 14:05$/);
    expect(formatCompactDateTime(date, "en-US", now)).toMatch(/^Oct 28,? 2:05\s?PM$/);
  });

  it("adds the year only for a date of another year", () => {
    expect(formatCompactDateTime(new Date(2025, 11, 31, 23, 59), "es-AR", now)).toContain("2025");
    expect(formatCompactDateTime(new Date(2026, 0, 2, 9, 0), "es-AR", now)).not.toContain("2026");
  });

  it("is short enough for a narrow column", () => {
    expect(formatCompactDateTime(new Date(2026, 9, 28, 14, 5), "es-AR", now).length).toBeLessThanOrEqual(14);
  });
});

describe("BackupTimeline date column", () => {
  // The year only shows for a date of another year, so these tests use the current one.
  const year = new Date().getFullYear();

  it("shows a compact date with the full date and time on hover", () => {
    const created = new Date(year, 5, 13, 2, 15);

    const { container } = render(
      <MemoryRouter>
        <BackupTimeline backups={[job(created.toISOString())]} />
      </MemoryRouter>,
    );

    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", created.toISOString());
    // "13 jun, 02:15", not "13/06/2026 02:15".
    expect(time?.textContent).toMatch(/^13 jun,? 02:15$/);
    expect(time?.textContent).not.toContain("/");
    expect(time?.getAttribute("title")).toContain(String(year));
    // The day and the time are units: a narrow column breaks between them, not inside "13 jun".
    const [day, , clock] = Array.from(time!.querySelectorAll("span"));
    expect(day).toHaveClass("whitespace-nowrap");
    expect(day?.textContent).toBe("13 jun");
    expect(clock).toHaveClass("whitespace-nowrap");
    expect(clock?.textContent).toBe("02:15");
    // Stacked on a narrow card, on one line once it is wide enough.
    expect(day).toHaveClass("block", "@sm:inline");
  });

  it("lets a long connection name wrap to two lines, so the date column keeps its room, with the full name on hover", () => {
    const long = { ...job(new Date().toISOString()), connectionName: "sandbox_shop_production_primary_replica_eu_west (PG)" };

    const { container } = render(
      <MemoryRouter>
        <BackupTimeline backups={[long]} />
      </MemoryRouter>,
    );

    const label = container.querySelector("span[title^=\"sandbox_shop_production_primary_replica_eu_west (PG)\"]");
    expect(label).not.toBeNull();
    // The shared label truncates to one line; this card overrides that on its inner span.
    for (const utility of ["[&>span]:line-clamp-2", "[&>span]:whitespace-normal", "[&>span]:[overflow-wrap:anywhere]"]) {
      expect(label).toHaveClass(utility);
    }
  });

  describe("in English", () => {
    useEnglishLocale();

    it("follows the language", () => {
      const created = new Date(year, 5, 13, 14, 15);

      const { container } = render(
        <MemoryRouter>
          <BackupTimeline backups={[job(created.toISOString())]} />
        </MemoryRouter>,
      );

      expect(container.querySelector("time")?.textContent).toMatch(/^Jun 13,? 2:15\s?PM$/);
    });
  });
});
