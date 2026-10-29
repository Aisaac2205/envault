import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dumps from "../index";

vi.mock("../hooks", () => ({
  useDumps: () => ({ data: [], total: 0, isLoading: false, error: null }),
  useBackupStreams: () => ({ track: () => {} }),
  useProdConnections: () => ({
    data: [{ id: "c1", name: "orders-production-primary-eu-west", dbType: "postgres", environment: "prod" }],
    isLoading: false,
  }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Dumps />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dumps page header on phones", () => {
  it("truncates the picked connection inside the picker instead of pushing its chevron out", () => {
    renderPage();

    // Radix drops the className given to Select.Value, so the trigger styles it.
    expect(screen.getByRole("combobox")).toHaveClass(
      "*:data-[slot=select-value]:min-w-0",
      "*:data-[slot=select-value]:truncate",
    );
  });

  it("moves the create button under the picker when both do not fit on one line", () => {
    renderPage();

    const picker = screen.getByRole("combobox");
    const create = screen.getByRole("button", { name: "Crear respaldo" });
    expect(picker.parentElement).toBe(create.parentElement);
    expect(picker.parentElement).toHaveClass("flex-wrap", "sm:flex-nowrap");
    expect(picker).toHaveClass("flex-[1_1_13.5rem]", "sm:flex-none");
    expect(create).toHaveClass("max-sm:grow");
  });
});
