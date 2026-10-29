import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AuditTable from "../AuditTable";
import type { AuditLog } from "../../types";

// Mock useConnections for ConnectionLabel usage inside ResourceCell
vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Dev DB", environment: "dev" },
      { id: "backup-1", name: "Daily Backup", environment: "prod" },
    ],
    isLoading: false,
  }),
}));

const mockLogs: AuditLog[] = [
  {
    id: "log-1",
    action: "backup.created",
    userId: "user-1",
    username: "admin",
    resourceType: "backup",
    resourceId: "backup-1",
    environment: "prod",
    createdAt: "2026-06-13T10:00:00Z",
    metadata: { name: "Daily Backup" },
  },
  {
    id: "log-2",
    action: "connection.updated",
    userId: "user-2",
    username: "dev1",
    resourceType: "connection",
    resourceId: "conn-1",
    environment: "dev",
    createdAt: "2026-06-13T11:00:00Z",
    metadata: { connectionName: "Dev DB" },
  },
  {
    id: "log-3",
    action: "restore.completed",
    userId: "user-1",
    username: "admin",
    resourceType: "restore",
    resourceId: "restore-1",
    environment: "qa",
    createdAt: "2026-06-13T12:00:00Z",
  },
];

describe("AuditTable", () => {
  function renderTable(logs = mockLogs, isLoading = false) {
    return render(
      <MemoryRouter>
        <AuditTable
          logs={logs}
          isLoading={isLoading}
          total={logs.length}
          page={1}
          pageSize={25}
          onPageChange={() => {}}
        />
      </MemoryRouter>,
    );
  }

  it("renders Entorno column header", () => {
    renderTable();
    expect(screen.getByText("Entorno")).toBeInTheDocument();
  });

  it("renders environment as clean formatted text", () => {
    renderTable();

    expect(screen.getByText("Producción")).toBeInTheDocument();
    expect(screen.getByText("Desarrollo")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();

    // EnvironmentBadge was previously used — verify no badge-specific classes
    const badges = document.querySelectorAll(".border-destructive\\/40");
    expect(badges.length).toBe(0);
  });

  it("uses muted-foreground styling for environment text", () => {
    renderTable();

    const prodElement = screen.getByText("Producción");
    expect(prodElement.classList.contains("text-muted-foreground")).toBe(true);
  });

  it("shows connection resources with ConnectionLabel", () => {
    renderTable();

    // ConnectionLabel renders the name (without inline badge), once per layout.
    expect(screen.getAllByText("Dev DB")).toHaveLength(2);
  });

  it("leaves the raw payload to the detail page instead of nesting it in a cell", () => {
    renderTable();

    // The table gives the shape of the event; the full record lives at
    // /audit/:id. A <pre> of JSON inside a <td> fights the table layout and
    // grows unbounded as the record gains fields.
    expect(screen.queryByText("Ver metadata")).not.toBeInTheDocument();
    expect(document.querySelector("table pre")).toBeNull();
  });

  it("renders empty state when no logs", () => {
    render(
      <MemoryRouter>
        <AuditTable
          logs={[]}
          isLoading={false}
          total={0}
          page={1}
          pageSize={25}
          onPageChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No hay registros de auditoría/i)).toBeInTheDocument();
  });
});

describe("AuditTable row navigation", () => {
  function renderTable() {
    return render(
      <MemoryRouter>
        <AuditTable
          logs={mockLogs}
          isLoading={false}
          total={mockLogs.length}
          page={1}
          pageSize={25}
          onPageChange={() => {}}
        />
      </MemoryRouter>,
    );
  }

  it("exposes each entry as a keyboard-reachable link to its detail page", () => {
    renderTable();

    const link = screen.getByRole("link", { name: /log-1/i });
    expect(link).toHaveAttribute("href", "/audit/log-1");
  });

  it("gives every row its own detail link", () => {
    renderTable();

    const links = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href")?.startsWith("/audit/"));
    expect(links).toHaveLength(mockLogs.length);
  });
});

describe("AuditTable on wide screens", () => {
  const longAction = "POST /api/backups/3e6bc28a-def9-4f2c-82ff-bc715a611bd8/download-url";
  const longUser = "maria.fernanda.rodriguez@contabilidad.example.com";

  function renderTable(logs = mockLogs) {
    return render(
      <MemoryRouter>
        <AuditTable logs={logs} isLoading={false} total={logs.length} page={1} pageSize={25} onPageChange={() => {}} />
      </MemoryRouter>,
    );
  }

  it("fixes the date, user and environment columns and gives the action the rest of the width", () => {
    renderTable();
    const table = screen.getByRole("table");

    expect(table).toHaveClass("table-fixed");
    const cols = Array.from(table.querySelectorAll("colgroup > col"));
    // Date, user, action, environment and the row link: the resource has no column of its own.
    expect(cols.map((col) => col.className)).toEqual(["w-42", "w-40 @4xl/table:w-56", "", "w-28", "w-10"]);
    expect(screen.getByRole("columnheader", { name: "Metadatos" })).toHaveClass("@2xl/table:hidden");
  });

  it("aligns every column left, headers with their data", () => {
    renderTable();

    for (const name of ["Fecha", "Usuario", "Acción", "Entorno"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("[&:not(:first-child)]:text-left");
    }
  });

  it("keeps the date on one line", () => {
    renderTable();

    expect(document.querySelector("tbody time")).toHaveClass("whitespace-nowrap", "tabular-nums");
  });

  it("clamps a long action to two lines and keeps the whole path in its title", () => {
    renderTable([{ ...mockLogs[0], action: longAction }]);

    const action = screen.getByText(longAction);
    expect(action).toHaveAttribute("title", longAction);
    expect(action).toHaveClass("@2xl/table:line-clamp-2", "@2xl/table:[overflow-wrap:anywhere]");
  });

  it("shows the resource as the action's muted second line", () => {
    renderTable();
    const row = screen.getByText("Producción").closest("tr") as HTMLElement;

    const secondLine = within(row)
      .getAllByText("Daily Backup")
      .find((el) => el.closest("td")?.classList.contains("@max-2xl/table:order-1")) as HTMLElement;
    expect(secondLine).toBeDefined();
    expect(secondLine).toHaveClass("text-muted-foreground", "truncate");
  });

  it("truncates a long user with the full address on hover", () => {
    renderTable([{ ...mockLogs[0], username: longUser }]);

    const user = screen.getByText(longUser);
    expect(user).toHaveClass("truncate");
    expect(user).toHaveAttribute("title", longUser);
  });
});

describe("AuditTable on narrow screens", () => {
  function renderTable({ total = mockLogs.length, page = 1 } = {}) {
    return render(
      <MemoryRouter>
        <AuditTable
          logs={mockLogs}
          isLoading={false}
          total={total}
          page={page}
          pageSize={25}
          onPageChange={() => {}}
        />
      </MemoryRouter>,
    );
  }

  function rowOf(text: string) {
    return screen.getByText(text).closest("tr") as HTMLElement;
  }

  it("names the table after the page subtitle", () => {
    renderTable();

    expect(screen.getByRole("region", { name: "Registro de actividades del sistema" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Registro de actividades del sistema" })).toBeInTheDocument();
  });

  it("keeps the timestamp visible in every layout, as a machine-readable time", () => {
    renderTable();

    const time = rowOf("Producción").querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-06-13T10:00:00Z");
    const cell = time?.closest("td");
    expect(cell).not.toHaveClass("hidden");
    expect(cell?.className).not.toMatch(/(^|\s)@max-(2xl|4xl)\/table:hidden/);
    expect(cell).toHaveClass("@max-2xl/table:order-5");
  });

  it("stacks each entry as a card: action as title, environment as badge, actor and time as meta", () => {
    renderTable();
    const row = rowOf("Producción");

    expect(within(row).getByText("backup.created").closest("td")).toHaveClass("@max-2xl/table:order-1");
    expect(within(row).getByText("Producción").closest("td")).toHaveClass("@max-2xl/table:order-2");
    expect(within(row).getByText("admin").closest("td")).toHaveClass("@max-2xl/table:order-5");
    expect(within(row).getByText("Producción").closest("td")).not.toHaveClass("hidden");
  });

  it("shows the resource as a labelled field without adding a second link", () => {
    renderTable();
    const row = rowOf("Producción");

    // The table layout repeats the resource under the action; the card's copy is its own field.
    const resourceCell = within(row)
      .getAllByText("Daily Backup")
      .map((el) => el.closest("td") as HTMLElement)
      .find((td) => td.classList.contains("@max-2xl/table:order-6")) as HTMLElement;
    expect(resourceCell).toBeDefined();
    expect(within(resourceCell).getByText("Metadatos")).toHaveAttribute("aria-hidden", "true");
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  it("leaves every card line as it was: the resource field stays, its table copy hides", () => {
    renderTable();
    const row = rowOf("Producción");

    const [secondLine] = within(row)
      .getAllByText("Daily Backup")
      .filter((el) => el.closest("td")?.classList.contains("@max-2xl/table:order-1"));
    expect(secondLine.closest(".\\@max-2xl\\/table\\:hidden")).not.toBeNull();
    // The action's wrapper steps out of the card layout, so the title cell lays out as before.
    expect(within(row).getByText("backup.created").closest(".\\@max-2xl\\/table\\:contents")).not.toBeNull();
  });

  it("puts the range on its own line when the pagination does not fit beside it", () => {
    renderTable({ total: 100, page: 2 });

    const range = screen.getByText("Mostrando 26–50 de 100");
    const footer = range.parentElement as HTMLElement;
    expect(footer).toHaveClass("flex-wrap");
    expect(range).not.toHaveClass("whitespace-nowrap");
    expect(range).toHaveClass("sm:whitespace-nowrap");

    const nav = within(footer).getByRole("navigation", { name: "Paginación" });
    expect(screen.getByRole("region", { name: "Registro de actividades del sistema" })).not.toContainElement(nav);
    expect(within(nav).getByText("2")).toHaveAttribute("aria-current", "page");
  });
});
