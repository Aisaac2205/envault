import { useMemo } from "react";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { useStorageByConnection } from "../hooks/useStorageByConnection";
import { PIE_SIZE, StoragePie } from "./storage-by-connection/StoragePie";
import { toStorageSlices } from "./storage-by-connection/storage-data";

/** A donut and three legend rows' worth of placeholder, so the card does not jump. */
function StorageLoading({ label }: { label: string }) {
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className="flex flex-col items-center gap-5 @sm:flex-row @sm:justify-center"
      role="status"
    >
      {/* A ring, like the donut it stands in for. */}
      <div
        className="shrink-0 animate-pulse rounded-full border-[26px] border-muted motion-reduce:animate-none"
        style={{ width: PIE_SIZE - 16, height: PIE_SIZE - 16 }}
      />
      <div className="w-full space-y-3 @sm:max-w-72">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

/** Where the stored backups are: the three largest connections and the rest, as a donut. */
export function StorageByConnectionChart() {
  const { t } = useTranslation("dashboard");
  const storage = useStorageByConnection();

  const slices = useMemo(
    () =>
      toStorageSlices(storage.data ?? [], {
        deleted: t("storage.deleted"),
        other: (count) => t("storage.other", { count }),
      }),
    [storage.data, t],
  );

  let body;
  if (storage.isLoading) {
    body = <StorageLoading label={t("storage.loading")} />;
  } else if (storage.isError) {
    body = (
      <Alert className="flex flex-wrap items-center justify-between gap-3" variant="destructive">
        <AlertDescription>
          {t("storage.error", {
            message: storage.error?.message ?? t("error.generic", { ns: "common" }),
          })}
        </AlertDescription>
        <Button onClick={() => void storage.refetch()} size="sm" variant="outline">
          {t("storage.retry")}
        </Button>
      </Alert>
    );
  } else if (slices.length === 0) {
    body = (
      <EmptyState
        className="py-6"
        description={t("storage.empty.description")}
        icon={<HardDrive />}
        title={t("storage.empty.title")}
      />
    );
  } else {
    body = <StoragePie slices={slices} />;
  }

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="pb-2">
        <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary">
          {t("storage.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("storage.subtitle")}</p>
      </CardHeader>
      <CardContent className="@container flex flex-1 items-center justify-center px-4 pb-5 sm:px-6">
        {body}
      </CardContent>
    </Card>
  );
}
