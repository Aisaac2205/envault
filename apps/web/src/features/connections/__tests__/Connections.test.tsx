import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import i18n from "@/i18n";
import Connections from "../index";
import * as hooks from "../hooks/useConnections";
import type { Connection, ConnectionTestResult } from "../types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../hooks/useConnections", () => ({
  useConnections: vi.fn(),
  useCreateConnection: vi.fn(),
  useUpdateConnection: vi.fn(),
  useDeleteConnection: vi.fn(),
  useTestConnection: vi.fn(),
  useTestRawConnection: vi.fn(),
}));

const connection: Connection = {
  id: "conn-1",
  name: "Orders DB",
  slug: "orders-db",
  dbType: "postgres",
  environment: "prod",
  host: "db.internal",
  port: 5432,
  database: "orders",
  username: "orders_user",
  isActive: true,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
};

// A mutation hook that exists but is never used by the test at hand.
function idleMutation<T>(): T {
  return { mutateAsync: vi.fn(), error: null } as unknown as T;
}

function mockTestResult(result: ConnectionTestResult) {
  vi.mocked(hooks.useTestConnection).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(result),
  } as unknown as ReturnType<typeof hooks.useTestConnection>);
}

describe("Connections page: testing a saved connection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(hooks.useConnections).mockReturnValue({
      data: [connection],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof hooks.useConnections>);
    vi.mocked(hooks.useCreateConnection).mockReturnValue(idleMutation());
    vi.mocked(hooks.useUpdateConnection).mockReturnValue(idleMutation());
    vi.mocked(hooks.useDeleteConnection).mockReturnValue(idleMutation());
    vi.mocked(hooks.useTestRawConnection).mockReturnValue(idleMutation());
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("es");
  });

  it("words the latency of a successful test in Spanish", async () => {
    const user = userEvent.setup();
    mockTestResult({ success: true, latencyMs: 12 });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Probar conexión" }));

    expect(toast.success).toHaveBeenCalledWith("Conexión exitosa", {
      description: "Latencia: 12ms",
    });
  });

  it("words the latency of a successful test in English", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("en");
    mockTestResult({ success: true, latencyMs: 12 });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(toast.success).toHaveBeenCalledWith("Connection successful", {
      description: "Latency: 12ms",
    });
  });

  it("reports the error of a failed test", async () => {
    const user = userEvent.setup();
    mockTestResult({
      success: false,
      latencyMs: 0,
      error: "password authentication failed",
    });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Probar conexión" }));

    expect(toast.error).toHaveBeenCalledWith("Conexión fallida", {
      description: "password authentication failed",
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
