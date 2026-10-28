import { useMemo } from "react";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { useStorageByConnection } from "../hooks/useStorageByConnection";
import { CardEmpty } from "./empty-states/CardEmpty";
import { PIE_SIZE, StoragePie } from "./storage-by-connection/StoragePie";
import { toStorageSlices } from "./storage-by-connection/storage-data";

/** The drawn donut's diameter: the chart leaves room around it for a slice to grow on hover. */
const RING_SIZE = PIE_SIZE - 16;
/** Three legend rows of the loading state: 3 × 36px and two 12px gaps. */
const LEGEND_HEIGHT = "min-h-[8.25rem]";

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
        style={{ width: RING_SIZE, height: RING_SIZE }}
      />
      <div className="w-full space-y-3 @sm:max-w-72">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}

/**
 * Nothing stored: the loading ring standing still, in the track color and no data
 * color, a muted drive where the total goes, and one line where the legend goes.
 * Same place and size as the loading state, so the card keeps its frame.
 */
function StorageEmpty({ message }: { message: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-5 @sm:flex-row @sm:justify-center">
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full border-[26px] border-muted text-muted-foreground"
        data-testid="storage-empty-ring"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        <HardDrive className="size-6" />
      </div>
      <CardEmpty className={`w-full @sm:max-w-72 ${LEGEND_HEIGHT}`} message={message} />
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
    body = <StorageEmpty message={t("storage.empty")} />;
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
