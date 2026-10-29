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

/** Opens the row's actions menu; both layouts render one, with the same actions. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getAllByRole("button", { name: `Acciones de ${name}` })[0]);
  return screen.findByRole("menu");
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

  it("offers Edit for a non-PROD connection in the row menu", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    const menu = await openRowMenu(user, "Orders QA");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Probar conexión",
      "Editar",
      "Eliminar",
    ]);
  });

  // The API refuses every change to a PROD connection, so its row only offers Delete.
  it("offers no Edit for a PROD connection", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([connection]);
    render(<Connections />);

    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    const menu = await openRowMenu(user, "Orders DB");
    expect(within(menu).queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("keeps Delete apart from the safe actions, in the destructive colour", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    const menu = await openRowMenu(user, "Orders QA");
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Eliminar" })).toHaveClass("text-destructive");
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

    await user.click(within(await openRowMenu(user, "Orders QA")).getByRole("menuitem", { name: "Eliminar" }));

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

    await user.click(within(await openRowMenu(user, "Orders QA")).getByRole("menuitem", { name: "Eliminar" }));

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
    await user.click(within(await openRowMenu(user, "Orders DB")).getByRole("menuitem", { name: "Eliminar" }));
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

    await user.click(within(await openRowMenu(user, "Orders DB")).getByRole("menuitem", { name: "Eliminar" }));
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

  it("stacks each connection: engine and name as title, state and actions menu beside it, environment as meta, host and database as fields", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);
    const row = rowOf("Orders QA");
    const cellOf = (text: string) => within(row).getByText(text).closest("td") as HTMLElement;

    const name = cellOf("Orders QA");
    expect(name).toHaveClass("@max-2xl/table:order-1");
    // The logo beside the name says the engine in every layout.
    expect(within(name).getByRole("img", { name: "PostgreSQL" }).parentElement).not.toHaveClass("hidden");

    const state = cellOf("Activa");
    expect(state).toHaveClass("@max-2xl/table:order-2");
    const cardMenu = within(state).getByRole("button", { name: "Acciones de Orders QA" });
    expect(cardMenu).toHaveClass("size-11");
    expect(cardMenu.parentElement).toHaveClass("@2xl/table:hidden");

    // The table repeats the environment under the name; the card keeps its meta cell.
    const environments = within(row).getAllByText("Desarrollo").map((el) => el.closest("td"));
    expect(environments.some((td) => td?.classList.contains("@max-2xl/table:order-5"))).toBe(true);
    const host = within(row).getByText(/db\.internal/).closest("td") as HTMLElement;
    expect(host).toHaveClass("@max-2xl/table:order-6");
    expect(host).not.toHaveClass("@max-2xl/table:hidden");
    expect(within(host).getByText("Host")).toHaveAttribute("aria-hidden", "true");
    expect(within(host).getByText(":5432")).not.toHaveClass("hidden");

    const database = cellOf("orders");
    expect(database).toHaveClass("@max-2xl/table:order-6");
    expect(within(database).getByText("BD")).toHaveAttribute("aria-hidden", "true");
  });

  it("gives a card no result line until a test result exists", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);
    const row = rowOf("Orders QA");

    const actions = within(row).getByRole("button", { name: "Probar conexión" }).closest("td") as HTMLElement;
    expect(actions).toHaveClass("@max-2xl/table:order-7", "@max-2xl/table:[&:not(:has([data-test-result]))]:hidden");
    expect(actions.querySelector("[data-test-result]")).toBeNull();
  });

  it("picks the test button, the menu or the card menu by the room the table has, not the viewport", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);
    const row = rowOf("Orders QA");

    const [cardMenu, tableMenu] = within(row).getAllByRole("button", { name: "Acciones de Orders QA" });
    expect(cardMenu.parentElement).toHaveClass("@2xl/table:hidden");
    expect(tableMenu.parentElement).toHaveClass("hidden", "@2xl/table:flex");
    expect(tableMenu).toHaveClass("size-8");
    // Below 56rem the table menu holds every action; from there the test is a button too.
    expect(within(row).getByRole("button", { name: "Probar conexión" })).toHaveClass("hidden", "@4xl/table:inline-flex");
    expect(within(row).queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    // A menu-only column is too narrow for its header, which stays for screen readers.
    expect(within(screen.getByRole("columnheader", { name: "Acciones" })).getByText("Acciones")).toHaveClass("@max-4xl/table:sr-only");
  });

  it("shows the test result under the name in the table and on the card's last line", async () => {
    const user = userEvent.setup();
    mockConnectionsPage([devConnection]);
    mockTestResult({ success: true, latencyMs: 12 });
    render(<Connections />);

    await user.click(screen.getByRole("button", { name: "Probar conexión" }));

    const results = await screen.findAllByText(/Conectado/);
    expect(results).toHaveLength(2);
    const [table, card] = results.map((el) => el.closest("[data-test-result]") as HTMLElement);
    expect(table.closest("td")).toHaveClass("@max-2xl/table:order-1");
    expect(table.parentElement).toHaveClass("@max-2xl/table:hidden");
    expect(card.closest("td")).toHaveClass("@max-2xl/table:order-7");
    expect(card).toHaveClass("contents", "@2xl/table:hidden");
  });
});

describe("Connections page on wide screens", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const longHost = "rrhh-replica-01.mysql.internal.example.com";

  it("drops the type and port columns: the logo says the engine and the port follows the host", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    const headers = within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Nombre", "Ambiente", "Host", "BD", "Estado", "Acciones"]);
    expect(screen.getByRole("columnheader", { name: "Ambiente" })).toHaveClass("@2xl/table:hidden");
  });

  it("fixes every column but the name, which takes the rest of the width", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);
    const table = screen.getByRole("table");

    expect(table).toHaveClass("table-fixed");
    expect(Array.from(table.querySelectorAll("colgroup > col")).map((col) => col.className)).toEqual([
      "",
      "w-40 @4xl/table:w-52 @6xl/table:w-64",
      "w-32 @4xl/table:w-40 @6xl/table:w-48",
      "w-28",
      "w-14 @4xl/table:w-48",
    ]);
  });

  it("shows the environment as the name's muted second line", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    const secondLine = screen
      .getAllByText("Desarrollo")
      .find((el) => el.closest("td")?.classList.contains("@max-2xl/table:order-1")) as HTMLElement;
    expect(secondLine).toHaveClass("text-muted-foreground");
    expect(secondLine.parentElement).toHaveClass("@max-2xl/table:hidden");
  });

  it("truncates a long host and database with the whole value on hover", () => {
    mockConnectionsPage([{ ...devConnection, host: longHost, port: 3306, database: "nomina_2026_historico" }]);
    render(<Connections />);

    const host = screen.getByText(new RegExp(longHost));
    expect(host).toHaveAttribute("title", `${longHost}:3306`);
    expect(host).toHaveClass("truncate", "@2xl/table:block");
    const database = screen.getByText("nomina_2026_historico");
    expect(database).toHaveAttribute("title", "nomina_2026_historico");
    expect(database).toHaveClass("truncate", "@2xl/table:block");
  });

  it("clamps a long name to two lines with the whole name in its title", () => {
    const longName = "Recursos Humanos y Nómina (réplica de lectura)";
    mockConnectionsPage([{ ...devConnection, name: longName }]);
    render(<Connections />);

    const name = screen.getByText(longName);
    expect(name).toHaveAttribute("title", longName);
    expect(name).toHaveClass("@2xl/table:line-clamp-2");
  });

  it("aligns every column left, headers with their data", () => {
    mockConnectionsPage([devConnection]);
    render(<Connections />);

    for (const name of ["Nombre", "Host", "BD", "Estado", "Acciones"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("[&:not(:first-child)]:text-left");
    }
  });
});
