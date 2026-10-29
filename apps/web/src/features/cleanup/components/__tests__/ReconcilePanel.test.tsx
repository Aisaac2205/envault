import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReconcilePanel } from "../ReconcilePanel";

vi.mock("../../hooks/useMaintenance", () => ({
  useReconcilePanel: () => ({
    data: { staleDbRows: [], orphanManifests: [], orphanDumps: [] },
    isLoading: false,
    isError: false,
    error: null,
    confirmOpen: false,
    setConfirmOpen: vi.fn(),
    stale: 1,
    manifests: 2,
    junkDumps: 1,
    restorable: 0,
    toClean: 4,
    handleConfirm: vi.fn(),
    isPending: false,
  }),
}));

describe("ReconcilePanel on phones", () => {
  it("puts the sync button under its status line instead of squeezing the status into a narrow column", () => {
    render(<ReconcilePanel />);

    const status = screen.getByRole("status");
    const sync = screen.getByRole("button", { name: "Sincronizar almacenamiento" });
    expect(status.parentElement).toBe(sync.parentElement);
    expect(status.parentElement).toHaveClass("flex-col", "sm:flex-row", "sm:items-center", "sm:justify-between");
  });
});
