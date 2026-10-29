import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RetentionDialog } from "../RetentionDialog";

vi.mock("../../hooks/useConnectionRetention", () => ({
  useConnectionRetention: () => ({
    rows: [],
    activePreset: "30",
    applyPreset: vi.fn(),
    updateRow: vi.fn(),
    handleSave: vi.fn(),
    handleRunCleanup: vi.fn(),
    isDirty: false,
    hasSavedPolicy: false,
    preview: [],
    prunable: [],
    totalCount: 0,
    totalMb: 0,
    previewLoading: false,
    isSaving: false,
    isRunning: false,
    confirmOpen: false,
    setConfirmOpen: vi.fn(),
    validationError: null,
    isLoading: false,
  }),
}));

describe("RetentionDialog on phones", () => {
  it("keeps the dialog's side margin on phones and its desktop width", () => {
    render(
      <RetentionDialog
        connection={{ slug: "orders", name: "orders", environment: "prod" }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /orders/ });
    expect(dialog).toHaveClass("max-w-[calc(100%-2rem)]", "sm:max-w-lg");
    expect(dialog).not.toHaveClass("max-w-xl");
  });
});
