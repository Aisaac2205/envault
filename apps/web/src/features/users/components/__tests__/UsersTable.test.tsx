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
