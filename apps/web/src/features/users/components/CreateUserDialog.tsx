import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserPlus, Eye, EyeOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/shared/ui/dialog";
import { useCreateUser } from "../hooks/useUsers";
import type { UserRole } from "../types";

export function CreateUserDialog() {
  const { t } = useTranslation("users");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>("user");

  const mutation = useCreateUser();

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setShowPassword(false);
    setRole("user");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" />
          {t("createUser.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createUser.title")}</DialogTitle>
          <DialogDescription>
            {t("createUser.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(
              { email, password, name, role },
              {
                onSuccess: () => {
                  setOpen(false);
                  reset();
                },
              },
            );
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="cu-name"
              className="text-sm font-medium text-foreground"
            >
              {t("createUser.field.name")}
            </label>
            <Input
              id="cu-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="cu-email"
              className="text-sm font-medium text-foreground"
            >
              {t("createUser.field.email")}
            </label>
            <Input
              id="cu-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="cu-pass"
              className="text-sm font-medium text-foreground"
            >
              {t("createUser.field.password")}
            </label>
            <div className="relative">
              <Input
                id="cu-pass"
                type={showPassword ? "text" : "password"}
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="pr-10"
                aria-describedby="cu-pass-hint"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword ? t("createUser.hide") : t("createUser.show")
                }
                aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p id="cu-pass-hint" className="text-xs text-muted-foreground">
              {t("createUser.hint.policy")}
            </p>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="cu-role"
              className="text-sm font-medium text-foreground"
            >
              {t("createUser.field.role")}
            </label>
            <select
              id="cu-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="user">{t("createUser.role.user")}</option>
              <option value="admin">{t("createUser.role.admin")}</option>
            </select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                {t("createUser.button.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("createUser.button.creating") : t("createUser.button.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
