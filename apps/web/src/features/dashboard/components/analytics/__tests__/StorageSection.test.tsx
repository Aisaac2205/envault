import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StorageSection } from "../StorageSection";
import type { ConnectionStorage } from "../../../types";

const rows: ConnectionStorage[] = [
  { connectionId: "c1", connectionName: "prod-db", totalSizeMb: 4100, backupCount: 12 },
  { connectionId: "c2", connectionName: "stg-db", totalSizeMb: 12400, backupCount: 40 },
  { connectionId: "c3", connectionName: null, totalSizeMb: 900, backupCount: 3 },
];

describe("StorageSection", () => {
  it("sorts connections descending by total size", () => {
    render(<StorageSection rows={rows} status="ready" />);

    const names = screen.getAllByTestId("storage-row-name").map((el) => el.textContent);
    expect(names).toEqual(["stg-db", "prod-db", "Conexión eliminada"]);
  });

  it("shows a fallback label for a deleted connection instead of omitting the row", () => {
    render(<StorageSection rows={rows} status="ready" />);

    expect(screen.getByText("Conexión eliminada")).toBeInTheDocument();
  });

  it("shows the live R2 figure when provided", () => {
    render(<StorageSection rows={rows} status="ready" liveTotalBytes={4_200_000_000} liveObjectCount={128} />);

    expect(screen.getByText(/R2 ahora:/)).toBeInTheDocument();
  });

  it("omits the live R2 figure when not provided", () => {
    render(<StorageSection rows={rows} status="ready" />);

    expect(screen.queryByText(/R2 ahora:/)).not.toBeInTheDocument();
  });

  it("renders the section skeleton while loading", () => {
    render(<StorageSection rows={[]} status="loading" />);

    expect(screen.getByTestId("storage-skeleton")).toBeInTheDocument();
  });

  it("renders an inline error with retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<StorageSection rows={[]} status="error" onRetry={onRetry} />);

    await user.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the section empty state when there are no rows", () => {
    render(<StorageSection rows={[]} status="empty" />);

    expect(screen.getByText("Aún no hay nada.")).toBeInTheDocument();
  });

  it("labels the section head as All time, not a window control", () => {
    render(<StorageSection rows={rows} status="ready" />);

    expect(screen.getByText("Histórico")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});
