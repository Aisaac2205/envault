import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Shield, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useAuth } from "@/shared/hooks/useAuth";
import { useToggleRole, useDeleteUser } from "../hooks/useUsers";
import { EditUserDialog } from "./EditUserDialog";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import type { User, UserRole } from "../types";

interface UserActionsProps {
  user: User;
}

const NEXT_ROLE: Record<UserRole, UserRole> = {
  admin: "user",
  user: "admin",
};

/**
 * Per-row actions. Desktop shows 4 icon buttons; mobile collapses to a
 * dropdown with the 2 most critical actions (toggle role, delete).
 *
 * Edit name and change password are desktop-only on this iteration — admin
 * work that happens almost exclusively on larger screens. Documented as a
 * deviation in the users-ui spec.
 */
export function UserActions({ user }: UserActionsProps) {
  const { t } = useTranslation("users");
  const { user: currentUser } = useAuth();
  const toggleRole = useToggleRole();
  const deleteUser = useDeleteUser();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const nextRole = NEXT_ROLE[user.role];
  const isSelf = currentUser?.id === user.id;

  function handleDelete() {
    deleteUser.mutate(
      { userId: user.id },
      { onSuccess: () => setDeleteOpen(false) },
    );
  }

  return (
    <>
      {/* Desktop: full button row */}
      <div className="hidden items-center justify-end gap-1 sm:flex">
        <Button
          variant="ghost"
          size="icon"
          title={t("actions.changeRole", { role: nextRole })}
          aria-label={t("actions.changeRoleAria", { name: user.name, role: nextRole })}
          onClick={() => toggleRole.mutate({ userId: user.id, role: nextRole })}
          disabled={toggleRole.isPending}
        >
          <Shield className="h-4 w-4" />
        </Button>
        <EditUserDialog userId={user.id} currentName={user.name} />
        <ChangePasswordDialog userId={user.id} userName={user.name} />
        <Button
          variant="ghost"
          size="icon"
          title={isSelf ? t("actions.deleteSelf") : t("actions.deleteUser")}
          aria-label={t("actions.deleteAria", { name: user.name })}
          onClick={() => setDeleteOpen(true)}
          disabled={deleteUser.isPending || isSelf}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Mobile: dropdown with the 2 most critical actions */}
      <div className="flex items-center justify-end sm:hidden">
        <DropdownMenuPrimitive.Root>
          <DropdownMenuPrimitive.Trigger asChild>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t("actions.actionsAria", { name: user.name })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
              className="z-50 min-w-[12rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              align="end"
            >
              <DropdownMenuPrimitive.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                onSelect={() =>
                  toggleRole.mutate({ userId: user.id, role: nextRole })
                }
                disabled={toggleRole.isPending}
              >
                <Shield className="h-4 w-4" />
                {t("actions.changeRole", { role: nextRole })}
              </DropdownMenuPrimitive.Item>
              <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
              <DropdownMenuPrimitive.Item
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                onSelect={(e) => {
                  e.preventDefault();
                  if (!isSelf) setDeleteOpen(true);
                }}
                disabled={isSelf || deleteUser.isPending}
              >
                <Trash2 className="h-4 w-4" />
                {isSelf ? t("actions.deleteSelf") : t("actions.deleteUser")}
              </DropdownMenuPrimitive.Item>
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      </div>

      <DeleteUserDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        userName={user.name}
        userEmail={user.email}
        isLoading={deleteUser.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}
