import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "@/i18n";
import { authClient } from "@/shared/lib/auth-client";
import { ChangePasswordDialog } from "../components/ChangePasswordDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { admin: { setUserPassword: vi.fn() } },
}));

// What the API answers when the password policy refuses a password
// (HTTP 400, code PASSWORD_TOO_WEAK): Better Auth's client turns it into
// `{ error: { message, code, status } }`.
const SERVER_MESSAGE = "Password cannot contain the user's name.";

async function openDialog(trigger: string) {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ChangePasswordDialog userId="user-1" userName="Ada Lovelace" />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: trigger }));
  return user;
}

const OPEN_ES = "Cambiar contraseña de Ada Lovelace";

describe("ChangePasswordDialog: password rules", () => {
  beforeEach(() => {
    vi.mocked(authClient.admin.setUserPassword).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  afterEach(async () => {
    await i18n.changeLanguage("es");
  });

  // jsdom never evaluates minlength (it has no user typing to compare with), so
  // the attribute is what can be asserted; the browser enforces it.
  it("asks for 12 characters on the field itself", async () => {
    await openDialog(OPEN_ES);

    const password = screen.getByLabelText("Nueva contraseña", { selector: "input" });
    expect(password).toHaveAttribute("minlength", "12");
    expect(password).toBeRequired();
  });

  it("tells the admin the length and what to avoid, in Spanish", async () => {
    await openDialog(OPEN_ES);

    const password = screen.getByLabelText("Nueva contraseña", { selector: "input" });
    expect(password).toHaveAccessibleDescription(/mínimo 12 caracteres/i);
    expect(password).toHaveAccessibleDescription(/contraseñas comunes/i);
    expect(password).toHaveAccessibleDescription(/patrones/i);
    expect(screen.queryByText(/8 caracteres/)).not.toBeInTheDocument();
  });

  it("tells the admin the length and what to avoid, in English", async () => {
    await i18n.changeLanguage("en");
    await openDialog("Change password for Ada Lovelace");

    const password = screen.getByLabelText("New password", { selector: "input" });
    expect(password).toHaveAccessibleDescription(/at least 12 characters/i);
    expect(password).toHaveAccessibleDescription(/common passwords/i);
    expect(password).toHaveAccessibleDescription(/patterns/i);
    expect(screen.queryByText(/8 characters/)).not.toBeInTheDocument();
  });

  it("shows the API's refusal in the toast and keeps the form open", async () => {
    vi.mocked(authClient.admin.setUserPassword).mockResolvedValue({
      data: null,
      error: { message: SERVER_MESSAGE, code: "PASSWORD_TOO_WEAK", status: 400, statusText: "Bad Request" },
    } as never);
    const user = await openDialog(OPEN_ES);

    await user.type(
      screen.getByLabelText("Nueva contraseña", { selector: "input" }),
      "ada lovelace 2026",
    );
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SERVER_MESSAGE));
    expect(authClient.admin.setUserPassword).toHaveBeenCalledWith({
      userId: "user-1",
      newPassword: "ada lovelace 2026",
    });
    expect(toast.success).not.toHaveBeenCalled();
    // The admin can fix the password without opening the dialog again.
    expect(screen.getByLabelText("Nueva contraseña", { selector: "input" })).toHaveValue(
      "ada lovelace 2026",
    );
  });

  it("changes the password and closes when it is accepted", async () => {
    vi.mocked(authClient.admin.setUserPassword).mockResolvedValue({ data: {}, error: null } as never);
    const user = await openDialog(OPEN_ES);

    await user.type(
      screen.getByLabelText("Nueva contraseña", { selector: "input" }),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Contraseña actualizada correctamente"),
    );
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText("Nueva contraseña", { selector: "input" })).not.toBeInTheDocument(),
    );
  });
});
