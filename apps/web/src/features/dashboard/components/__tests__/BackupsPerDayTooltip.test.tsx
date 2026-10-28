import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BackupsPerDayTooltip } from "../backups-per-day/BackupsPerDayTooltip";

const DATE = new Date(2026, 9, 27);

describe("BackupsPerDayTooltip", () => {
  it("shows the day, both counts and the success rate of that day", () => {
    render(
      <BackupsPerDayTooltip
        point={{ label: "27 oct", date: DATE, completed: 24, failed: 1 }}
      />,
    );

    expect(screen.getByText("mar, 27 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Completados")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("Fallidos")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Tasa de éxito")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();
  });

  it("shows an em dash for the rate of a day with no backups, not 0% or 100%", () => {
    render(
      <BackupsPerDayTooltip
        point={{ label: "27 oct", date: DATE, completed: 0, failed: 0 }}
      />,
    );

    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("shows 0% for a day where every backup failed", () => {
    render(
      <BackupsPerDayTooltip
        point={{ label: "27 oct", date: DATE, completed: 0, failed: 4 }}
      />,
    );

    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("marks each status with an icon as well as a color and a word", () => {
    const { container } = render(
      <BackupsPerDayTooltip
        point={{ label: "27 oct", date: DATE, completed: 3, failed: 2 }}
      />,
    );

    // One glyph per status row, hidden from screen readers: the word carries the meaning.
    const glyphs = container.querySelectorAll("svg[aria-hidden='true']");
    expect(glyphs).toHaveLength(2);
  });

  it("copes with a point that has no date", () => {
    render(<BackupsPerDayTooltip point={{ completed: 1, failed: 0 }} />);

    expect(screen.getByText("Completados")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
