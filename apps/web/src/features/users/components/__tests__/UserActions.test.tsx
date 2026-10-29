import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserActions } from "../UserActions";
import type { User } from "../../types";

vi.mock("@/shared/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "ada@example.com", name: "Ada Lovelace", role: "admin" } }),
}));

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { admin: {} },
}));

const grace: User = {
  id: "u2",
  email: "grace@example.com",
  name: "Grace Hopper",
  role: "user",
  banned: null,
  createdAt: "2026-03-02T10:00:00Z",
  updatedAt: "2026-03-02T10:00:00Z",
  emailVerified: true,
};

const ada: User = { ...grace, id: "u1", email: "ada@example.com", name: "Ada Lovelace", role: "admin" };

function renderActions(user: User) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserActions user={user} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

async function openPhoneMenu(user: User) {
  const events = renderActions(user);
  await events.click(screen.getByRole("button", { name: `Acciones de ${user.name}` }));
  return { events, menu: await screen.findByRole("menu") };
}

// The phone menu replaces the icon row below sm, so it must offer every action the
// row offers on a desktop, under the same rules.
describe("UserActions phone menu", () => {
  it("offers every desktop action: change role, edit name, change password and delete", async () => {
    const { menu } = await openPhoneMenu(grace);

    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Cambiar a admin",
      "Editar nombre",
      "Cambiar contraseña",
      "Eliminar usuario",
    ]);
  });

  it("opens the edit name dialog with the current name", async () => {
    const { events, menu } = await openPhoneMenu(grace);

    await events.click(within(menu).getByRole("menuitem", { name: "Editar nombre" }));

    const dialog = await screen.findByRole("dialog", { name: "Editar usuario" });
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("Grace Hopper");
  });

  it("opens the change password dialog", async () => {
    const { events, menu } = await openPhoneMenu(grace);

    await events.click(within(menu).getByRole("menuitem", { name: "Cambiar contraseña" }));

    const dialog = await screen.findByRole("dialog", { name: "Cambiar contraseña" });
    expect(within(dialog).getByLabelText("Nueva contraseña", { selector: "input" })).toHaveValue("");
  });

  it("gives the page back once the dialog opened from the menu closes", async () => {
    const { events, menu } = await openPhoneMenu(grace);

    await events.click(within(menu).getByRole("menuitem", { name: "Editar nombre" }));
    await screen.findByRole("dialog", { name: "Editar usuario" });
    await events.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("keeps the desktop rules on the own account: name and password editable, delete disabled", async () => {
    const { menu } = await openPhoneMenu(ada);

    expect(within(menu).getByRole("menuitem", { name: "Editar nombre" })).not.toHaveAttribute("aria-disabled");
    expect(within(menu).getByRole("menuitem", { name: "Cambiar contraseña" })).not.toHaveAttribute("aria-disabled");
    expect(
      within(menu).getByRole("menuitem", { name: "No puedes eliminar tu propia cuenta de usuario" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});

describe("UserActions desktop row", () => {
  it("still opens the edit name dialog from its own button, with the current name", async () => {
    const events = renderActions(grace);

    await events.click(screen.getByRole("button", { name: "Editar nombre de Grace Hopper" }));

    const dialog = await screen.findByRole("dialog", { name: "Editar usuario" });
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("Grace Hopper");
  });
});
