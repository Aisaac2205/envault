import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RestoreMeter } from "../RestoreMeter";
import type { RestoreStatusCounts } from "../../../types";

describe("RestoreMeter", () => {
  it("shows every segment's count and label, even a small fraction", () => {
    const counts: RestoreStatusCounts = {
      completed: 91,
      failed: 5,
      running: 1,
      pending: 3,
      total: 100,
    };

    render(<RestoreMeter counts={counts} />);

    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    // running=1 is a small fraction (1%) — its count must still be readable,
    // not clipped or omitted (Restore Status Meter "Small segment" scenario).
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("labels each segment with status text, never color-only", () => {
    const counts: RestoreStatusCounts = { completed: 10, failed: 2, running: 1, pending: 1, total: 14 };
    render(<RestoreMeter counts={counts} />);

    expect(screen.getByText("Completado")).toBeInTheDocument();
    expect(screen.getByText("Fallido")).toBeInTheDocument();
    expect(screen.getByText("En ejecución")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("sizes each meter segment proportionally to its share of the total", () => {
    const counts: RestoreStatusCounts = { completed: 50, failed: 50, running: 0, pending: 0, total: 100 };
    const { container } = render(<RestoreMeter counts={counts} />);

    const segments = container.querySelectorAll("[data-segment]");
    const completedSegment = Array.from(segments).find(
      (el) => el.getAttribute("data-segment") === "completed",
    );
    expect(completedSegment).toHaveStyle({ width: "50%" });
  });

  it("has an accessible description with the full breakdown", () => {
    const counts: RestoreStatusCounts = { completed: 40, failed: 2, running: 1, pending: 1, total: 44 };
    render(<RestoreMeter counts={counts} />);

    expect(
      screen.getByLabelText(/40 completadas, 2 fallidas, 1 en ejecución, 1 pendientes, de 44 en total/i),
    ).toBeInTheDocument();
  });
});
