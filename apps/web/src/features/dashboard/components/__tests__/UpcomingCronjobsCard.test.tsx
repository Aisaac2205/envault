import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { CronjobEntity } from "../../types";
import { UpcomingCronjobsCard } from "../UpcomingCronjobsCard";

function makeCronjob(overrides: Partial<CronjobEntity>): CronjobEntity {
  return {
    id: "cj-1",
    name: "Nightly backup",
    isActive: true,
    schedule: { kind: "daily", time: "02:00" },
    connectionId: "conn-1",
    connectionName: null,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    ...overrides,
  };
}

describe("UpcomingCronjobsCard", () => {
  it("shows the connection name under the cronjob name", () => {
    render(
      <UpcomingCronjobsCard
        cronjobs={[makeCronjob({ connectionName: "Prod DB" })]}
      />,
    );

    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.queryByText("Todos los días a las 02:00")).not.toBeInTheDocument();
  });

  it("falls back to the schedule in plain language when there is no connection name", () => {
    render(<UpcomingCronjobsCard cronjobs={[makeCronjob({})]} />);

    expect(screen.getByText("Todos los días a las 02:00")).toBeInTheDocument();
  });

  it("follows the active language", async () => {
    await i18n.changeLanguage("en");
    try {
      render(
        <UpcomingCronjobsCard
          cronjobs={[
            makeCronjob({
              schedule: { kind: "weekly", time: "09:30", daysOfWeek: [1, 5] },
            }),
          ]}
        />,
      );

      expect(
        screen.getByText("Every Monday and Friday at 09:30"),
      ).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("es");
    }
  });

  it("falls back to a generic label for a schedule the builder cannot represent", () => {
    render(<UpcomingCronjobsCard cronjobs={[makeCronjob({ schedule: null })]} />);

    expect(screen.getByText("Programación personalizada")).toBeInTheDocument();
  });

  it("never renders the raw cron expression the API still sends", () => {
    // The API still sends the expression; the type no longer knows about it.
    const withExpression = {
      ...makeCronjob({ schedule: null }),
      cronExpression: "*/7 3-5 * * 2,4",
    };

    const { container } = render(
      <UpcomingCronjobsCard cronjobs={[withExpression]} />,
    );

    expect(container.textContent).not.toContain("*/7");
  });
});
