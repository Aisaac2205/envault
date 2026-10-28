import { useId } from "react";
import { ArrowRight, CircleCheck, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatDateTime } from "@/lib/format";
import { ConnectionLabel } from "@/shared/components/ConnectionLabel";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { RECENT_FAILURES_LIMIT, useRecentFailures } from "../hooks/useRecentFailures";
import type { BackupJob } from "../types";
import { formatCompactDateTime } from "./compact-date";
import { CardEmpty } from "./empty-states/CardEmpty";
import { type DataPresence, isNothingYet } from "./empty-states/data-presence";
import { useDurationLocale } from "./dump-duration/use-duration-locale";
import { firstErrorLine } from "./recent-failures/failure-message";

/** The body's height while loading and when empty: five rows with a one line error. */
const BODY_HEIGHT = "min-h-80";

/**
 * One row per failure the card can list, each the height of a row with a one
 * line error, so the card keeps its size when the data arrives.
 */
function FailuresLoading({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-live="polite" className={`divide-y divide-border/60 ${BODY_HEIGHT}`} role="status">
      {Array.from({ length: RECENT_FAILURES_LIMIT }, (_, row) => (
        <div className="space-y-1 py-2.5 first:pt-0" key={row}>
          <Skeleton className="h-5 w-2/5 motion-reduce:animate-none" />
          <Skeleton className="h-5 w-4/5 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function FailureRow({ job, locale }: { job: BackupJob; locale: string }) {
  const { t } = useTranslation("dashboard");
  const line = firstErrorLine(job.errorMessage);

  return (
    <li className="min-w-0 py-2.5 first:pt-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <ConnectionLabel
          className="min-w-0 text-sm font-medium leading-5 text-text-primary"
          id={job.connectionId}
          name={job.connectionName}
        />
        {/* The compact date keeps the name its room; the full one is on hover. */}
        <time
          className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
          dateTime={job.createdAt}
          title={formatDateTime(job.createdAt)}
        >
          {formatCompactDateTime(job.createdAt, locale)}
        </time>
      </div>
      {line ? (
        // The cause is the first line; the details below it are on hover with the rest.
        <p
          className="mt-1 line-clamp-2 text-xs leading-5 text-text-secondary [overflow-wrap:anywhere]"
          title={job.errorMessage ?? undefined}
        >
          {line}
        </p>
      ) : (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("failures.noDetails")}</p>
      )}
    </li>
  );
}

interface RecentFailuresCardProps {
  /** What the dashboard has to show, from the page; it picks what an empty list says. */
  presence?: DataPresence;
}

/**
 * The latest failed backups: which connection, when, and why. The card title
 * already says they failed, so the rows carry no status badge. Connection status
 * has the last backup of every connection; this card is about what went wrong.
 */
export function RecentFailuresCard({ presence = "unknown" }: RecentFailuresCardProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const titleId = useId();
  const failures = useRecentFailures();
  const rows = failures.data ?? [];

  let body;
  if (failures.isLoading) {
    body = <FailuresLoading label={t("failures.loading")} />;
  } else if (failures.isError) {
    body = (
      <Alert className="flex flex-wrap items-center justify-between gap-3" variant="destructive">
        <AlertDescription>
          {t("failures.error", {
            message: failures.error?.message ?? t("error.generic", { ns: "common" }),
          })}
        </AlertDescription>
        <Button onClick={() => void failures.refetch()} size="sm" variant="outline">
          {t("failures.retry")}
        </Button>
      </Alert>
    );
  } else if (rows.length === 0) {
    body = isNothingYet(presence) ? (
      // Nothing ran yet, so there is nothing to be glad about either: a neutral line.
      <CardEmpty className={`flex-1 ${BODY_HEIGHT}`} icon={<History />} message={t("failures.noData")} />
    ) : (
      // Backups ran and none failed: said in words, the icon in the success color only repeats it.
      <CardEmpty
        className={`flex-1 ${BODY_HEIGHT}`}
        icon={<CircleCheck aria-hidden="true" className="text-success" />}
        message={t("failures.empty")}
      />
    );
  } else {
    body = (
      <ul aria-labelledby={titleId} className="divide-y divide-border/60">
        {rows.map((job) => (
          <FailureRow job={job} key={job.id} locale={locale} />
        ))}
      </ul>
    );
  }

  return (
    // min-w-0: inside the two column row the card may be narrower than its longest name.
    <Card className="flex h-full min-w-0 flex-col overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="pb-2">
        <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary" id={titleId}>
          {t("failures.title")}
        </h2>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col px-4 pb-4 sm:px-6">
        {body}
        {/* Pinned to the bottom, so it sits in the same place beside the taller storage card. With no
            connection there is nothing to look at, and the welcome banner is the one way forward, so the
            link goes; its row stays, so the card keeps its height. */}
        <div className="mt-auto pt-3">
          <div className="h-8 pointer-coarse:h-11" data-testid="failures-footer">
            {presence !== "no-connections" && (
              <Link
                className="inline-flex h-full items-center gap-1 rounded-sm text-xs font-medium text-text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
                to="/dumps"
              >
                {t("failures.viewAll")}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
