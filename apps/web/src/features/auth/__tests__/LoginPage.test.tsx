import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "@/i18n";
import { authClient } from "@/shared/lib/auth-client";
import LoginPage from "../LoginPage";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: {
    useSession: vi.fn(),
    signIn: { email: vi.fn() },
  },
}));

// The brand panel paints a WebGL shader, which jsdom cannot provide.
vi.mock("@paper-design/shaders-react", () => ({
  GrainGradient: () => null,
}));

const signInEmail = vi.mocked(authClient.signIn.email);

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Dashboard screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function submitCredentials(
  user: ReturnType<typeof userEvent.setup>,
  { email = "admin@envault.local", password = "s3cret-pass" } = {},
) {
  await user.type(screen.getByLabelText("Correo electrónico"), email);
  await user.type(screen.getByLabelText("Contraseña"), password);
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: false,
    } as unknown as ReturnType<typeof authClient.useSession>);
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("es");
  });

  describe("when the API cannot be reached", () => {
    it("tells the user and lets them try again", async () => {
      const user = userEvent.setup();
      signInEmail.mockRejectedValue(new TypeError("Failed to fetch"));
      renderLoginPage();

      await submitCredentials(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
      );
      expect(
        screen.getByRole("button", { name: "Iniciar sesión" }),
      ).toBeEnabled();
      expect(screen.queryByText("Iniciando sesión...")).not.toBeInTheDocument();
    });

    it("words the message in the interface language", async () => {
      const user = userEvent.setup();
      await i18n.changeLanguage("en");
      signInEmail.mockRejectedValue(new TypeError("Failed to fetch"));
      renderLoginPage();

      await user.type(screen.getByLabelText("Email address"), "admin@envault.local");
      await user.type(screen.getByLabelText("Password"), "s3cret-pass");
      await user.click(screen.getByRole("button", { name: "Sign in" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "We couldn't reach the server. Check your connection and try again.",
      );
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    });

    it("drops the message and signs in once the retry succeeds", async () => {
      const user = userEvent.setup();
      signInEmail
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({ data: {}, error: null } as never);
      renderLoginPage();

      await submitCredentials(user);
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

      expect(await screen.findByText("Dashboard screen")).toBeInTheDocument();
      expect(signInEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the API answers", () => {
    it("shows the message the server gives for refused credentials", async () => {
      const user = userEvent.setup();
      signInEmail.mockResolvedValue({
        data: null,
        error: { message: "Invalid email or password", status: 401 },
      } as never);
      renderLoginPage();

      await submitCredentials(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Invalid email or password",
      );
      expect(
        screen.getByRole("button", { name: "Iniciar sesión" }),
      ).toBeEnabled();
    });

    it("falls back to the generic credentials message when the server gives none", async () => {
      const user = userEvent.setup();
      signInEmail.mockResolvedValue({
        data: null,
        error: { status: 401 },
      } as never);
      renderLoginPage();

      await submitCredentials(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Credenciales inválidas",
      );
    });

    it("sends the user to the dashboard after a successful sign-in", async () => {
      const user = userEvent.setup();
      signInEmail.mockResolvedValue({ data: {}, error: null } as never);
      renderLoginPage();

      await submitCredentials(user);

      expect(await screen.findByText("Dashboard screen")).toBeInTheDocument();
      expect(signInEmail).toHaveBeenCalledWith({
        email: "admin@envault.local",
        password: "s3cret-pass",
      });
    });
  });
});
