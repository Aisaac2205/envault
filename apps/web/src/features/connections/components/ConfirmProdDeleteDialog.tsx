import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { AlertTriangle } from "lucide-react";
import type { ProdDeleteConfirmation } from "../types";

interface ConfirmProdDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the PROD connection to delete; it must be typed back exactly. */
  connectionName: string;
  isLoading: boolean;
  /** Why the last attempt was refused, as the API worded it. */
  error: string | null;
  onConfirm: (confirmation: ProdDeleteConfirmation) => void;
}

/**
 * Step-up confirmation for deleting a PROD connection: the admin types the
 * connection's exact name and their current password, which the API checks
 * before it deletes. Both are forgotten as soon as the dialog closes.
 */
export function ConfirmProdDeleteDialog({
  open,
  onOpenChange,
  connectionName,
  isLoading,
  error,
  onConfirm,
}: ConfirmProdDeleteDialogProps) {
  const { t } = useTranslation("connections");
  const [typedName, setTypedName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the typed name and the password when the dialog closes, keyed on the `open` prop
      setTypedName("");
      setPassword("");
    }
  }, [open]);

  // The API compares the name exactly, so neither case nor spaces are forgiven.
  const nameMatches = typedName === connectionName;
  const canConfirm = nameMatches && password.length > 0 && !isLoading;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm({ confirmName: typedName, password });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("deleteProd.title")}
            </DialogTitle>
            <DialogDescription>{t("deleteProd.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-prod-delete-name"
                className="text-sm text-muted-foreground"
              >
                {t("deleteProd.nameLabel", { name: connectionName })}
              </label>
              <Input
                id="confirm-prod-delete-name"
                autoComplete="off"
                autoFocus
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                disabled={isLoading}
                placeholder={connectionName}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirm-prod-delete-password"
                className="text-sm text-muted-foreground"
              >
                {t("deleteProd.passwordLabel")}
              </label>
              <Input
                id="confirm-prod-delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              {t("deleteProd.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!canConfirm}>
              {isLoading ? t("deleteProd.deleting") : t("deleteProd.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
