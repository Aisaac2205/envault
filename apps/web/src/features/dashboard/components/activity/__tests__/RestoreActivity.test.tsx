import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RestoreActivity } from "../RestoreActivity";
import type { RestoreJob } from "../../../types";

const restores: RestoreJob[] = [
  {
    id: "aaaa1111-0000-0000-0000-000000000000",
    targetConnectionId: "c1",
    targetEnvironment: "production",
    isDryRun: false,
    status: "completed",
    createdAt: "2026-06-13T02:15:00Z",
  },
  {
    id: "bbbb2222-0000-0000-0000-000000000000",
    targetConnectionId: "c2",
    targetEnvironment: "staging",
    isDryRun: true,
    status: "running",
    createdAt: "2026-06-13T03:00:00Z",
  },
];

describe("RestoreActivity", () => {
  it("renders each restore's short id, environment and dry-run/full label", () => {
    render(<RestoreActivity restores={restores} />);

    expect(screen.getByText(/aaaa1111/)).toBeInTheDocument();
    expect(screen.getByText(/bbbb2222/)).toBeInTheDocument();
    expect(screen.getByText("Producción · Restauración")).toBeInTheDocument();
    expect(screen.getByText("Staging · Simulación")).toBeInTheDocument();
  });

  it("caps visible rows at maxItems", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...restores[0],
      id: `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`,
    }));
    render(<RestoreActivity restores={many} maxItems={3} />);

    expect(screen.getAllByText(/^#/)).toHaveLength(3);
  });
});
