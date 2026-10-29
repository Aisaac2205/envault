import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsersTable } from "../UsersTable";
import type { User } from "../../types";

vi.mock("@/shared/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "ada@example.com", name: "Ada", role: "admin" } }),
}));

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { admin: {} },
}));

const users: User[] = [
  {
    id: "u1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "admin",
    banned: null,
    createdAt: "2026-01-12T10:00:00Z",
    updatedAt: "2026-01-12T10:00:00Z",
    emailVerified: true,
  },
  {
    id: "u2",
    email: "grace@example.com",
    name: "Grace Hopper",
    role: "user",
    banned: true,
    createdAt: "2026-03-02T10:00:00Z",
    updatedAt: "2026-03-02T10:00:00Z",
    emailVerified: true,
  },
];

function renderTable() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UsersTable users={users} loading={false} />
    </QueryClientProvider>,
  );
}

describe("UsersTable headers", () => {
  it("labels every column with a translated name, never a raw key", () => {
    renderTable();

    const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual(["Nombre", "Correo", "Rol", "Creado", "Acciones"]);
  });
});

describe("UsersTable on narrow screens", () => {
  function rowOf(name: string) {
    return screen.getByText(name).closest("tr") as HTMLElement;
  }

  it("names the table after the page", () => {
    renderTable();

    expect(screen.getByRole("region", { name: "Usuarios" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Usuarios" })).toBeInTheDocument();
  });

  it("stacks each user: name as title with the actions beside it, email as meta, role and creation date as fields", () => {
    renderTable();
    const row = rowOf("Grace Hopper");
    const cellOf = (text: string) => within(row).getByText(text).closest("td") as HTMLElement;

    expect(cellOf("Grace Hopper")).toHaveClass("@max-2xl/table:order-1");
    expect(cellOf("Suspendido")).toBe(cellOf("Grace Hopper"));
    expect(within(row).getByRole("button", { name: "Acciones de Grace Hopper" }).closest("td")).toHaveClass(
      "@max-2xl/table:order-3",
      "relative",
      "z-10",
    );
    expect(cellOf("grace@example.com")).toHaveClass("@max-2xl/table:order-5");
    for (const [text, label] of [
      ["Usuario", "Rol"],
      ["2 mar 2026", "Creado"],
    ]) {
      const cell = cellOf(text);
      expect(cell).toHaveClass("@max-2xl/table:order-6");
      expect(within(cell).getByText(label)).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("lets a long name and email wrap inside the card instead of widening it", () => {
    renderTable();

    expect(screen.getByText("Grace Hopper")).toHaveClass("@max-2xl/table:[overflow-wrap:anywhere]");
    expect(screen.getByText("grace@example.com")).toHaveClass("@max-2xl/table:[overflow-wrap:anywhere]");
  });

  it("gives the phone actions menu a 44px target", () => {
    renderTable();

    expect(screen.getByRole("button", { name: "Acciones de Grace Hopper" })).toHaveClass("size-11");
  });
});
