import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CronjobsTable from "../CronjobsTable";
import type { Cronjob } from "../../types";

// Mock useConnections to return test connection data
vi.mock("@/features/connections/hooks/useConnections", () => ({
  useConnections: () => ({
    data: [
      { id: "conn-1", name: "Prod DB", environment: "prod", dbType: "postgres" },
      { id: "conn-2", name: "Dev DB", environment: "dev", dbType: "mysql" },
      { id: "conn-3", name: "QA DB", environment: "qa" },
    ],
    isLoading: false,
  }),
}));

const mockCronjobs = [
  {
    id: "cj-1",
    name: "Daily Backup",
    connectionId: "conn-1",
    connectionName: "Prod DB",
    schedule: { kind: "daily" as const, time: "02:00" },
    isActive: true,
    lastRunAt: "2026-06-13T02:00:00Z",
    nextRunAt: "2026-06-14T02:00:00Z",
    lastStatus: "completed" as const,
  },
  {
    id: "cj-2",
    name: "Dev Snapshot",
    connectionId: "conn-2",
    connectionName: "Dev DB",
    schedule: { kind: "every_hours" as const, everyHours: 6 as const },
    isActive: false,
    nextRunAt: "2026-06-13T18:00:00Z",
    lastStatus: undefined,
  },
];

describe("CronjobsTable", () => {
  const defaultProps = {
    cronjobs: mockCronjobs,
    isLoading: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onToggle: vi.fn(),
    toggleLoading: {} as Record<string, boolean>,
  };

  it("renders Entorno column header", () => {
    render(<CronjobsTable {...defaultProps} />);
    expect(screen.getByText("Entorno")).toBeInTheDocument();
  });

  it("renders environment as clean formatted text for each row", () => {
    render(<CronjobsTable {...defaultProps} />);

    // Once in the card's meta line and once in the table's second line.
    expect(screen.getAllByText("Producción")).toHaveLength(2);
    expect(screen.getAllByText("Desarrollo")).toHaveLength(2);
  });

  it("renders hyphen for unknown connection", () => {
    const cronjobs = [
      {
        ...mockCronjobs[0],
        connectionId: "nonexistent",
      },
    ];
    render(<CronjobsTable {...defaultProps} cronjobs={cronjobs} />);
    // The card says so; the table's second line just leaves the environment out.
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("does not render EnvironmentBadge in the connection column", () => {
    render(<CronjobsTable {...defaultProps} />);
    // EnvironmentBadge used border-destructive/40 for prod items — verify absent
    const badgeElements = document.querySelectorAll(".border-destructive\\/40");
    expect(badgeElements.length).toBe(0);
  });

  it("removes showEnv from ConnectionLabel usage", () => {
    render(<CronjobsTable {...defaultProps} />);
    // Connection names should still render
    expect(screen.getAllByText("Prod DB")).toHaveLength(2);
    expect(screen.getAllByText("Dev DB")).toHaveLength(2);
  });

  it("renders Entorno column in table header", () => {
    render(<CronjobsTable {...defaultProps} />);
    // The header should still show Entorno
    expect(screen.getByText("Entorno")).toBeInTheDocument();
  });

  it("renders the schedule column header", () => {
    render(<CronjobsTable {...defaultProps} />);
    expect(screen.getByText("Programación", { selector: "th" })).toBeInTheDocument();
    // The caption names the table after the page ("Cronjobs"); no column says cron.
    expect(screen.queryByText(/cron/i, { ignore: "caption, script, style" })).not.toBeInTheDocument();
  });

  it("describes each schedule in plain language", () => {
    render(<CronjobsTable {...defaultProps} />);
    expect(screen.getByText("Todos los días a las 02:00")).toBeInTheDocument();
    expect(screen.getByText("Cada 6 horas")).toBeInTheDocument();
  });

  it("shows the schedule as a labelled line of the card on small screens instead of hiding it", () => {
    render(<CronjobsTable {...defaultProps} />);
    const header = screen.getByText("Programación", { selector: "th" });
    const cell = screen.getByText("Todos los días a las 02:00").closest("td") as HTMLElement;
    for (const element of [header, cell]) {
      expect(element).not.toHaveClass("hidden");
    }
    expect(cell).toHaveClass("@max-2xl/table:order-6");
    expect(within(cell).getByText("Programación")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a generic label for a schedule the builder cannot represent", () => {
    const legacy: Cronjob[] = [{ ...mockCronjobs[0], schedule: null }];
    render(<CronjobsTable {...defaultProps} cronjobs={legacy} />);
    expect(screen.getByText("Programación personalizada")).toBeInTheDocument();
  });

  it("never renders the raw cron expression the API still sends", () => {
    const legacy: Cronjob = { ...mockCronjobs[0], schedule: null };
    // The API still sends the expression; the type no longer knows about it.
    const withExpression = { ...legacy, cronExpression: "*/7 3-5 * * 2,4" };
    const { container } = render(
      <CronjobsTable {...defaultProps} cronjobs={[withExpression]} />,
    );
    expect(container.textContent).not.toContain("*/7");
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it("leads each connection name with the official logo of its engine, in both layouts", () => {
    render(<CronjobsTable {...defaultProps} />);

    for (const [engine, name] of [
      ["PostgreSQL", "Prod DB"],
      ["MySQL", "Dev DB"],
    ]) {
      const logoCells = screen.getAllByRole("img", { name: engine }).map((img) => img.closest("td"));
      const nameCells = screen.getAllByText(name).map((el) => el.closest("td"));
      expect(logoCells).toEqual(nameCells);
    }
  });

  it("keeps the connection name alone when its engine is unknown", () => {
    const cronjobs = [{ ...mockCronjobs[0], connectionId: "conn-3", connectionName: "QA DB" }];
    render(<CronjobsTable {...defaultProps} cronjobs={cronjobs} />);

    expect(screen.getAllByText("QA DB")).toHaveLength(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("names the table after the page", () => {
    render(<CronjobsTable {...defaultProps} />);

    expect(screen.getByRole("region", { name: "Cronjobs" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Cronjobs" })).toBeInTheDocument();
  });

  it("stacks each cronjob: name as title, switch and menu beside it, connection and environment as meta, the rest as fields", () => {
    render(<CronjobsTable {...defaultProps} />);
    const row = screen.getByText("Daily Backup").closest("tr") as HTMLElement;
    const cellOf = (text: string) => within(row).getByText(text).closest("td");
    // The table repeats the connection and environment under the name; the card keeps its meta cells.
    const metaCellOf = (text: string) =>
      within(row)
        .getAllByText(text)
        .map((el) => el.closest("td"))
        .find((td) => td?.classList.contains("@max-2xl/table:order-5"));

    expect(cellOf("Daily Backup")).toHaveClass("@max-2xl/table:order-1");
    expect(metaCellOf("Prod DB")).toBeDefined();
    expect(metaCellOf("Producción")).toBeDefined();
    expect(within(row).getByRole("switch").closest("td")).toHaveClass("@max-2xl/table:order-3", "relative", "z-10");
    expect(within(row).getByRole("button", { name: "Acciones de Daily Backup" }).closest("td")).toHaveClass("@max-2xl/table:order-3");
    for (const [text, label] of [
      ["Completado", "Último estado"],
      ["Todos los días a las 02:00", "Programación"],
    ]) {
      const cell = cellOf(text) as HTMLElement;
      expect(cell).toHaveClass("@max-2xl/table:order-6");
      expect(within(cell).getByText(label)).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("gives the switch and the actions menu 44px targets in cards", () => {
    render(<CronjobsTable {...defaultProps} />);
    const row = screen.getByText("Daily Backup").closest("tr") as HTMLElement;

    expect(within(row).getByRole("switch")).toHaveClass("@max-2xl/table:size-11");
    expect(within(row).getByRole("button", { name: "Acciones de Daily Backup" })).toHaveClass("size-11", "@2xl/table:size-8");
  });

  it("shows Edit as a button only once the table has the room, and every action in the menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<CronjobsTable {...defaultProps} onDelete={onDelete} />);
    const row = screen.getByText("Daily Backup").closest("tr") as HTMLElement;

    expect(within(row).getByRole("button", { name: "Editar" })).toHaveClass("hidden", "@4xl/table:inline-flex");
    expect(within(row).queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    // A menu-only column is too narrow for its header, which stays for screen readers.
    expect(within(screen.getByRole("columnheader", { name: "Acciones" })).getByText("Acciones")).toHaveClass("@max-4xl/table:sr-only");

    await user.click(within(row).getByRole("button", { name: "Acciones de Daily Backup" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Editar", "Eliminar"]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    const remove = within(menu).getByRole("menuitem", { name: "Eliminar" });
    expect(remove).toHaveClass("text-destructive");
    await user.click(remove);
    expect(onDelete).toHaveBeenCalledWith("cj-1");
  });

  it("fixes every column but the name, which takes the rest of the width", () => {
    render(<CronjobsTable {...defaultProps} />);
    const table = screen.getByRole("table");

    expect(table).toHaveClass("table-fixed");
    // Name, schedule, next run, last status, active and actions: connection and environment ride under the name.
    expect(Array.from(table.querySelectorAll("colgroup > col")).map((col) => col.className)).toEqual([
      "",
      "w-32",
      "w-42",
      "w-32",
      "w-18",
      "w-14 @4xl/table:w-32",
    ]);
    for (const name of ["Conexión", "Entorno"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("@2xl/table:hidden");
    }
  });

  it("shows the engine, the connection and the environment as the name's muted second line", () => {
    render(<CronjobsTable {...defaultProps} />);
    const row = screen.getByText("Daily Backup").closest("tr") as HTMLElement;
    const nameCell = within(row).getByText("Daily Backup").closest("td") as HTMLElement;

    const secondLine = within(nameCell).getByText("Prod DB").closest(".\\@max-2xl\\/table\\:hidden") as HTMLElement;
    expect(secondLine).toHaveClass("text-muted-foreground");
    expect(within(secondLine).getByRole("img", { name: "PostgreSQL" })).toBeInTheDocument();
    expect(within(secondLine).getByText("Producción")).toBeInTheDocument();
  });

  it("clamps a long name and schedule to two lines, whole in their titles", () => {
    const longName = "Respaldo diario de contabilidad general (madrugada)";
    render(<CronjobsTable {...defaultProps} cronjobs={[{ ...mockCronjobs[0], name: longName }]} />);

    expect(screen.getByText(longName)).toHaveAttribute("title", longName);
    expect(screen.getByText(longName)).toHaveClass("@2xl/table:line-clamp-2");
    expect(screen.getByText("Todos los días a las 02:00")).toHaveAttribute("title", "Todos los días a las 02:00");
  });

  it("keeps the next run on one line and aligns every column left", () => {
    render(<CronjobsTable {...defaultProps} />);

    expect(screen.getByText("Próxima ejecución", { selector: "th" })).toHaveClass("[&:not(:first-child)]:text-left");
    for (const name of ["Nombre", "Programación", "Último estado", "Activo", "Acciones"]) {
      expect(screen.getByRole("columnheader", { name })).toHaveClass("[&:not(:first-child)]:text-left");
    }
    const nextRun = screen.getAllByText((_, el) => el?.tagName === "SPAN" && /\d{2}\/\d{2}\/\d{4}/.test(el.textContent ?? "") && el.children.length === 0)[0];
    expect(nextRun).toHaveClass("whitespace-nowrap");
  });

  it("renders empty state when no cronjobs", () => {
    render(<CronjobsTable {...defaultProps} cronjobs={[]} />);
    expect(screen.getByText(/No hay cronjobs/i)).toBeInTheDocument();
  });
});
