import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "@/i18n";
import { authClient } from "@/shared/lib/auth-client";
import { CreateUserDialog } from "../components/CreateUserDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { admin: { createUser: vi.fn() } },
}));

// What the API answers when the password policy refuses a password
// (HTTP 400, code PASSWORD_TOO_WEAK): Better Auth's client turns it into
// `{ error: { message, code, status } }`.
const SERVER_MESSAGE =
  "Password is too common or too easy to guess. Use a longer passphrase made of words that do not belong together.";

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateUserDialog />
    </QueryClientProvider>,
  );
}

async function openDialog(trigger: string) {
  const user = userEvent.setup();
  renderDialog();
  await user.click(screen.getByRole("button", { name: trigger }));
  return user;
}

describe("CreateUserDialog: password rules", () => {
  beforeEach(() => {
    vi.mocked(authClient.admin.createUser).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  afterEach(async () => {
    await i18n.changeLanguage("es");
  });

  // jsdom never evaluates minlength (it has no user typing to compare with), so
  // the attribute is what can be asserted; the browser enforces it.
  it("asks for 12 characters on the field itself", async () => {
    await openDialog("Agregar usuario");

    const password = screen.getByLabelText("Contraseña", { selector: "input" });
    expect(password).toHaveAttribute("minlength", "12");
    expect(password).toBeRequired();
  });

  it("tells the admin the length and what to avoid, in Spanish", async () => {
    await openDialog("Agregar usuario");

    const password = screen.getByLabelText("Contraseña", { selector: "input" });
    expect(password).toHaveAccessibleDescription(/mínimo 12 caracteres/i);
    expect(password).toHaveAccessibleDescription(/contraseñas comunes/i);
    expect(password).toHaveAccessibleDescription(/patrones/i);
    expect(screen.queryByText(/8 caracteres/)).not.toBeInTheDocument();
  });

  it("tells the admin the length and what to avoid, in English", async () => {
    await i18n.changeLanguage("en");
    await openDialog("Add user");

    const password = screen.getByLabelText("Password", { selector: "input" });
    expect(password).toHaveAccessibleDescription(/at least 12 characters/i);
    expect(password).toHaveAccessibleDescription(/common passwords/i);
    expect(password).toHaveAccessibleDescription(/patterns/i);
    expect(screen.queryByText(/8 characters/)).not.toBeInTheDocument();
  });

  it("shows the API's refusal in the toast and keeps the form open", async () => {
    vi.mocked(authClient.admin.createUser).mockResolvedValue({
      data: null,
      error: { message: SERVER_MESSAGE, code: "PASSWORD_TOO_WEAK", status: 400, statusText: "Bad Request" },
    } as never);
    const user = await openDialog("Agregar usuario");

    await user.type(screen.getByLabelText("Nombre"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Correo electrónico"), "ada@example.com");
    await user.type(screen.getByLabelText("Contraseña", { selector: "input" }), "password1234");
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SERVER_MESSAGE));
    expect(authClient.admin.createUser).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "password1234",
      name: "Ada Lovelace",
      role: "user",
    });
    expect(toast.success).not.toHaveBeenCalled();
    // The admin can fix the password without retyping the rest.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Contraseña", { selector: "input" })).toHaveValue("password1234");
  });

  it("creates the user and closes when the password is accepted", async () => {
    vi.mocked(authClient.admin.createUser).mockResolvedValue({ data: {}, error: null } as never);
    const user = await openDialog("Agregar usuario");

    await user.type(screen.getByLabelText("Nombre"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Correo electrónico"), "ada@example.com");
    await user.type(
      screen.getByLabelText("Contraseña", { selector: "input" }),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Usuario creado correctamente"));
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument());
  });
});
