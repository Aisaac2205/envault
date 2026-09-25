import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Separator } from "@/shared/ui/separator";
import { formatDateTimeShort, formatEnvironment } from "@/lib/format";
import apiClient from "../../shared/lib/api-client";
import type { AuditLog, AuditOutcome, AuditSeverity } from "./types";

const OUTCOME_VARIANT: Record<AuditOutcome, "default" | "destructive"> = {
  success: "default",
  failure: "destructive",
};

// Severity earns colour only once it means something. Painting every row
// leaves nothing for the events that actually warrant a second look.
const SEVERITY_CLASS: Record<AuditSeverity, string> = {
  low: "text-muted-foreground",
  medium: "text-amber-600 dark:text-amber-500",
  high: "text-orange-600 dark:text-orange-500",
  critical: "text-destructive",
};

async function fetchAuditLog(id: string): Promise<AuditLog> {
  const response = await apiClient.get<AuditLog>(`/audit/${id}`);
  return response.data;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium capitalize text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm break-words text-text-primary">{children}</dd>
    </div>
  );
}

/**
 * An empty object is not data. A DELETE carries no body and most mutations
 * carry no query string, so the interceptor stores {body:{}, query:{}} —
 * rendering those gives the reader boxes to scan that hold nothing.
 */
function hasContent(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function presentMetadata(
  metadata: Record<string, unknown>,
): [string, unknown][] {
  return Object.entries(metadata).filter(([, value]) => hasContent(value));
}

function MetadataEntries({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <Field key={key} label={key}>
          {typeof value === "string" || typeof value === "number" ? (
            String(value)
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-relaxed">
              {JSON.stringify(value, null, 2)}
            </pre>
          )}
        </Field>
      ))}
    </dl>
  );
}

export default function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("audit");

  const { data: log, error } = useQuery({
    queryKey: ["audit", id],
    queryFn: () => fetchAuditLog(id ?? ""),
    enabled: Boolean(id),
  });

  const metadataEntries = presentMetadata(log?.metadata ?? {});

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        to="/audit"
        className="group inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft
          className="size-5 -ml-1 transition-transform duration-150 ease-out group-hover:-translate-x-0.5"
          strokeWidth={2.5}
          aria-hidden="true"
        />
        {t("page.title")}
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      {log ? (
        <article className="space-y-8 rounded-xl bg-card p-6 shadow-sm">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold text-text-primary">
                {log.action}
              </h1>
              {log.outcome ? (
                <Badge
                  data-testid="audit-outcome"
                  variant={OUTCOME_VARIANT[log.outcome]}
                >
                  {t(`outcome.${log.outcome}`, log.outcome)}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {formatDateTimeShort(log.createdAt)}
            </p>
          </header>

          <Separator />

          {/* Who — the question an investigation starts from. */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("detail.actor")}
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("detail.username")}>{log.username}</Field>
              <Field label={t("detail.userId")}>
                {log.userId}
              </Field>
              {log.ipAddress ? (
                <Field label={t("detail.ipAddress")}>
                  {log.ipAddress}
                </Field>
              ) : null}
              {log.userAgent ? (
                <Field label={t("detail.userAgent")}>
                  {log.userAgent}
                </Field>
              ) : null}
            </dl>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("detail.event")}
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label={t("detail.resourceType")}>{log.resourceType}</Field>
              <Field label={t("detail.resourceId")}>
                {log.resourceId}
              </Field>
              {log.severity ? (
                <Field label={t("detail.severity")}>
                  <span className={SEVERITY_CLASS[log.severity]}>
                    {t(`severity.${log.severity}`, log.severity)}
                  </span>
                </Field>
              ) : null}
              {log.environment ? (
                <Field label={t("detail.environment")}>
                  {formatEnvironment(log.environment)}
                </Field>
              ) : null}
            </dl>
          </section>

          {metadataEntries.length > 0 ? (
            <>
              <Separator />
              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-text-primary">
                  {t("detail.metadata")}
                </h2>
                <MetadataEntries entries={metadataEntries} />
              </section>
            </>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}
