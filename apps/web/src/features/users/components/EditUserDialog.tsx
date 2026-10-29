import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
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
import { useUpdateUser } from "../hooks/useUsers";

interface EditUserDialogProps {
  userId: string;
  currentName: string;
  /** Controlled open state, for a second way in such as the phone row menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EditUserDialog({
  userId,
  currentName,
  open: openProp,
  onOpenChange,
}: EditUserDialogProps) {
  const { t } = useTranslation("users");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [name, setName] = useState(currentName);
  const [wasOpen, setWasOpen] = useState(open);

  // Every opening starts from the current name, whichever way it was opened.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName(currentName);
  }

  const mutation = useUpdateUser();

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("actions.editName")}
          aria-label={t("actions.editNameAria", { name: currentName })}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
          <DialogDescription>{currentName}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(
              { userId, data: { name } },
              { onSuccess: () => setOpen(false) },
            );
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="eu-name"
              className="text-sm font-medium text-foreground"
            >
              Nombre
            </label>
            <Input
              id="eu-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={mutation.isPending || name.trim() === currentName.trim()}
            >
              {mutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
