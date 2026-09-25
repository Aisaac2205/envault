import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GrainGradient } from "@paper-design/shaders-react";
import { authClient } from "@/shared/lib/auth-client";
import { Button } from "@/shared/ui/button";
import { FadeIn } from "@/shared/ui/motion/FadeIn";

function LoginBrandPanel() {
  const { t } = useTranslation("auth");

  return (
    <div className="relative hidden min-h-screen overflow-hidden bg-black lg:flex items-end p-8 lg:p-12 xl:p-16">
      <GrainGradient
        speed={1}
        scale={1}
        softness={0.5}
        intensity={0.5}
        noise={0.25}
        shape="corners"
        colors={["#ffffffff", "#b4b4b4ff", "#bfe70ac4", "#ffffff"]}
        colorBack="#00000000"
        className="absolute inset-0"
      />

      <div className="relative z-10 flex flex-col gap-4">
        <h2 className="max-w-[480px] text-3xl font-medium tracking-[-0.04em] text-white sm:text-4xl lg:text-5xl leading-[1.12]">
          {t("brand.title")}
        </h2>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isPending && session?.user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: authError } = await authClient.signIn.email({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message ?? t("error.invalidCredentials"));
      return;
    }

    navigate("/");
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2 antialiased selection:bg-black/15 selection:text-black">
      <div className="flex min-h-screen flex-col justify-between bg-white px-8 py-10 sm:px-14 md:px-18 lg:px-16 xl:px-24">
        <div className="flex items-center self-start">
          <img src="/logo.png" alt="EnVault Management" className="h-14 w-auto self-start sm:h-16 invert" />
        </div>
        <FadeIn className="my-auto py-10">
          <div className="mx-auto w-full max-w-[420px]">
            <h1 className="text-2xl font-medium tracking-[-0.03em] text-black sm:text-3xl lg:text-4xl">
              {t("page.title")}
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-[#666]">
              {t("page.subtitle")}
            </p>

            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="mt-8 space-y-4.5 sm:mt-10"
              aria-live="polite"
            >
              {error && (
                <div
                  id="login-error"
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-black"
                >
                  {t("label.email")}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder={t("placeholder.email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? "login-error" : undefined}
                  className="h-12 w-full rounded-[10px] border border-[#e5e5e5] bg-white px-4 text-base text-black outline-none transition-all placeholder:text-[#999] focus:border-black/60 focus:ring-2 focus:ring-black/10"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-black"
                >
                  {t("label.password")}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder={t("placeholder.password")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby={error ? "login-error" : undefined}
                    className="h-12 w-full rounded-[10px] border border-[#e5e5e5] bg-white px-4 pr-12 text-base text-black outline-none transition-all placeholder:text-[#999] focus:border-black/60 focus:ring-2 focus:ring-black/10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-3.5 flex items-center text-[#999] transition-colors hover:text-black"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-[10px] bg-black text-white text-base font-medium transition-all hover:bg-black/90 disabled:opacity-50 mt-2 cursor-pointer"
              >
                {loading ? t("action.submitting") : t("action.submit")}
              </Button>
            </form>
          </div>
        </FadeIn>

        <p className="text-xs text-[#999]">
          &copy; {new Date().getFullYear()} EnVault Management. {t("footer")}
        </p>
      </div>
      <LoginBrandPanel />
    </div>
  );
}
