import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
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

const devConnection: Connection = {
  ...connection,
  id: "conn-2",
  name: "Orders QA",
  slug: "orders-qa",
  environment: "dev",
};

// A mutation hook that exists but is never used by the test at hand.
function idleMutation<T>(): T {
  return { mutateAsync: vi.fn(), reset: vi.fn(), error: null } as unknown as T;
}

/** An Axios error as the client rejects it when the API refuses with `message`. */
function apiError(status: number, message: string): AxiosError {
  const response = {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {
      error: { code: "ForbiddenException", message, statusCode: status },
      timestamp: "2026-10-26T10:00:00Z",
      path: "/api/connections/conn-1",
    },
  } as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_REQUEST,
    undefined,
    undefined,
    response,
  );
}

function mockConnectionsPage(
  connections: Connection[],
  mutations: {
    deleteConnection?: ReturnType<typeof hooks.useDeleteConnection>;
    updateConnection?: ReturnType<typeof hooks.useUpdateConnection>;
  } = {},
) {
  vi.mocked(hooks.useConnections).mockReturnValue({
    data: connections,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof hooks.useConnections>);
  vi.mocked(hooks.useCreateConnection).mockReturnValue(idleMutation());
  vi.mocked(hooks.useUpdateConnection).mockReturnValue(
    mutations.updateConnection ?? idleMutation(),
  );
  vi.mocked(hooks.useDeleteConnection).mockReturnValue(
    mutations.deleteConnection ?? idleMutation(),
  );
  vi.mocked(hooks.useTestConnection).mockReturnValue(idleMutation());
  vi.mocked(hooks.useTestRawConnection).mockReturnValue(idleMutation());
}

function deleteMutation(mutateAsync: ReturnType<typeof vi.fn>) {
  return {
    mutateAsync,
    reset: vi.fn(),
    error: null,
  } as unknown as ReturnType<typeof hooks.useDeleteConnection>;
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

describe("Connections page: actions per environment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("offers Edit for a non-PROD connection", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  // The API refuses every change to a PROD connection, so its row only offers Delete.
  it("offers no Edit for a PROD connection", () => {
    mockConnectionsPage([connection]);
    render(<Connections />);

    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("offers no Edit for a PROD connection in the mobile menu", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([connection]);
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Acciones" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("offers Edit for a non-PROD connection in the mobile menu", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Acciones" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Editar" })).toBeInTheDocument();
  });
});

describe("Connections page: deleting a non-PROD connection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks with the browser confirmation and deletes without a body", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockConnectionsPage([devConnection], { deleteConnection: deleteMutation(mutateAsync) });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(confirm).toHaveBeenCalledWith("¿Deseas eliminar permanentemente esta conexión?");
    expect(mutateAsync).toHaveBeenCalledWith({ id: "conn-2" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Conexión eliminada");
  });

  it("keeps the connection when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const mutateAsync = vi.fn();
    mockConnectionsPage([devConnection], { deleteConnection: deleteMutation(mutateAsync) });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe("Connections page: deleting a PROD connection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openDialog(mutateAsync = vi.fn().mockResolvedValue(undefined)) {
    const user = userEvent.setup();
    mockConnectionsPage([connection], { deleteConnection: deleteMutation(mutateAsync) });
    render(<Connections />);
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Eliminar conexión de producción",
    });
    return {
      user,
      mutateAsync,
      dialog,
      nameInput: within(dialog).getByLabelText("Escribe Orders DB para confirmar"),
      passwordInput: within(dialog).getByLabelText("Tu contraseña"),
      confirmButton: within(dialog).getByRole("button", { name: "Eliminar conexión" }),
    };
  }

  it("asks in a dialog instead of the browser confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { passwordInput } = await openDialog();

    expect(confirm).not.toHaveBeenCalled();
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
  });

  it("keeps the confirm button disabled until the exact name and a password are given", async () => {
    const { user, nameInput, passwordInput, confirmButton } = await openDialog();
    expect(confirmButton).toBeDisabled();

    await user.type(passwordInput, "s3cret");
    expect(confirmButton).toBeDisabled();

    // The API compares the name exactly: case and surrounding spaces count.
    await user.type(nameInput, "orders db");
    expect(confirmButton).toBeDisabled();
    await user.clear(nameInput);
    await user.type(nameInput, "Orders DB ");
    expect(confirmButton).toBeDisabled();

    await user.clear(nameInput);
    await user.type(nameInput, "Orders DB");
    expect(confirmButton).toBeEnabled();

    await user.clear(passwordInput);
    expect(confirmButton).toBeDisabled();
  });

  it("sends the name and password and closes once deleted", async () => {
    const { user, mutateAsync, nameInput, passwordInput, confirmButton } = await openDialog();

    await user.type(nameInput, "Orders DB");
    await user.type(passwordInput, "s3cret");
    await user.click(confirmButton);

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "conn-1",
      confirmation: { confirmName: "Orders DB", password: "s3cret" },
    });
    expect(toast.success).toHaveBeenCalledWith("Conexión eliminada");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server message inside the dialog and stays open when refused", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(apiError(403, "La confirmación de contraseña falló."));
    const { user, dialog, nameInput, passwordInput, confirmButton } =
      await openDialog(mutateAsync);

    await user.type(nameInput, "Orders DB");
    await user.type(passwordInput, "wrong");
    await user.click(confirmButton);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "La confirmación de contraseña falló.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Request failed with status code 403")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a lockout message from the server inside the dialog", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        apiError(
          429,
          "Demasiadas confirmaciones de contraseña fallidas. Vuelva a intentarlo más tarde.",
        ),
      );
    const { user, dialog, nameInput, passwordInput, confirmButton } =
      await openDialog(mutateAsync);

    await user.type(nameInput, "Orders DB");
    await user.type(passwordInput, "wrong");
    await user.click(confirmButton);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Demasiadas confirmaciones de contraseña fallidas.",
    );
  });

  it("forgets the typed name and password when the dialog closes", async () => {
    const { user, nameInput, passwordInput } = await openDialog();
    await user.type(nameInput, "Orders DB");
    await user.type(passwordInput, "s3cret");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByLabelText("Tu contraseña")).toHaveValue("");
    expect(within(reopened).getByLabelText("Escribe Orders DB para confirmar")).toHaveValue("");
  });
});

describe("Connections page: errors from the API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the server message instead of the HTTP status text", () => {
    mockConnectionsPage([devConnection], {
      updateConnection: {
        mutateAsync: vi.fn(),
        reset: vi.fn(),
        error: apiError(403, "Las conexiones de producción no se pueden modificar."),
      } as unknown as ReturnType<typeof hooks.useUpdateConnection>,
    });
    render(<Connections />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Las conexiones de producción no se pueden modificar.",
    );
    expect(screen.queryByText("Request failed with status code 403")).not.toBeInTheDocument();
  });

  it("falls back to the generic message when the server sent none", () => {
    mockConnectionsPage([devConnection], {
      updateConnection: {
        mutateAsync: vi.fn(),
        reset: vi.fn(),
        error: new AxiosError("Network Error", AxiosError.ERR_NETWORK),
      } as unknown as ReturnType<typeof hooks.useUpdateConnection>,
    });
    render(<Connections />);

    expect(screen.getByRole("alert")).toHaveTextContent("Error inesperado");
  });
});

describe("Connections page on narrow screens", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function rowOf(name: string) {
    return screen.getByRole("row", { name: new RegExp(name) });
  }

  it("names the table after the page", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    expect(screen.getByRole("region", { name: "Conexiones" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Conexiones" })).toBeInTheDocument();
  });

  it("stacks each connection: name as title, state as badge, environment as meta, actions last", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);
    const row = rowOf("Orders QA");

    expect(within(row).getByText("Orders QA").closest("td")).toHaveClass("@max-2xl/table:order-1");
    expect(within(row).getByText("Activa").closest("td")).toHaveClass("@max-2xl/table:order-2");
    expect(within(row).getByText("Desarrollo").closest("td")).toHaveClass("@max-2xl/table:order-5");
    expect(within(row).getByRole("button", { name: "Acciones" }).closest("td")).toHaveClass(
      "@max-2xl/table:order-7",
      "relative",
      "z-10",
    );
    expect(within(row).getByText("db.internal").closest("td")).toHaveClass("@max-2xl/table:hidden");
  });

  it("picks the button row or the menu by the room the table has, not the viewport", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);
    const row = rowOf("Orders QA");

    expect(within(row).getByRole("button", { name: "Editar" }).parentElement).toHaveClass("hidden", "@2xl/table:flex");
    expect(within(row).getByRole("button", { name: "Acciones" }).parentElement).toHaveClass("@2xl/table:hidden");
  });

  it("shows the test result once, where both layouts see it", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([devConnection]);
    mockTestResult({ success: true, latencyMs: 12 });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Probar conexión" }));

    const results = await screen.findAllByText(/Conectado/);
    expect(results).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Editar" }).parentElement).not.toContainElement(results[0]);
    expect(results[0].closest("td")).toHaveClass("@max-2xl/table:order-7");
  });
});
