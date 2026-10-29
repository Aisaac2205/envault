import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { RestoreDto, Connection } from "../types";
import type { EnrichedR2Object } from "@/features/dumps/types";
import { ConnectionSelector } from "./ConnectionSelector";
import { ConnectionDetails } from "./ConnectionDetails";
import { R2DumpPicker } from "./R2DumpPicker";
import { RestoreFormSection } from "./RestoreFormSection";
import { RestoreOptions } from "./RestoreOptions";
import { RestoreActions } from "./RestoreActions";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import cloudflareSvg from "@/shared/assets/Cloudflare.svg";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";
import { FileText, ArrowRight } from "lucide-react";

interface BackupInfo {
  /** Null when the connection was deleted after the backup ran. */
  connectionName?: string | null;
  environment?: string;
  date?: string;
  fileSizeMb?: number | null;
}

interface RestoreFormProps {
  sourceBackupId?: string;
  dbType?: "postgres" | "mysql" | null;
  backupInfo?: BackupInfo;
  selectedR2Dump?: EnrichedR2Object | null;
  onR2DumpChange?: (dump: EnrichedR2Object | null) => void;
  onDryRun: (dto: RestoreDto) => void;
  onRestore: (dto: RestoreDto) => void;
  isLoading: boolean;
  connections: Connection[];
  connectionsLoading: boolean;
  sourceConnections: Connection[];
  sourceConnectionsLoading?: boolean;
}

const DB_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

const DB_LOGOS: Record<string, string> = {
  postgres: postgresSvg as string,
  mysql: mysqlSvg as string,
};

export function RestoreForm({
  sourceBackupId,
  dbType,
  backupInfo,
  selectedR2Dump,
  onR2DumpChange,
  onDryRun,
  onRestore,
  isLoading,
  connections,
  connectionsLoading,
  sourceConnections,
  sourceConnectionsLoading = false,
}: RestoreFormProps) {
  const { t } = useTranslation(["restore", "common"]);
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [isDryRun, setIsDryRun] = useState(true);

  const effectiveDbType = selectedR2Dump?.dbType ?? dbType ?? null;
  const hasSource = !!sourceBackupId || !!selectedR2Dump;
  const showR2Selector = !sourceBackupId;

  const compatibleConnections = useMemo(() => {
    if (!effectiveDbType) return connections;
    return connections.filter((c) => c.dbType === effectiveDbType);
  }, [connections, effectiveDbType]);

  const canSimulate = targetConnectionId !== "" && hasSource;
  const hasConnections = compatibleConnections.length > 0;
  const selectedConnection = useMemo(
    () => compatibleConnections.find((c) => c.id === targetConnectionId),
    [compatibleConnections, targetConnectionId],
  );

  function handleSimulate() {
    if (!hasSource) {
      toast.warning(t("toast.selectDump"));
      return;
    }
    if (!canSimulate) return;
    const dto: RestoreDto = {
      sourceBackupId: selectedR2Dump ? undefined : (sourceBackupId ?? ""),
      r2Key: selectedR2Dump?.key,
      targetConnectionId,
      isDryRun: true,
    };
    onDryRun(dto);
  }

  function handleExecute() {
    if (!hasSource) {
      toast.warning(t("toast.selectDumpRestore"));
      return;
    }
    if (!targetConnectionId) return;
    const dto: RestoreDto = {
      sourceBackupId: selectedR2Dump ? undefined : (sourceBackupId ?? ""),
      r2Key: selectedR2Dump?.key,
      targetConnectionId,
      isDryRun: false,
    };
    onRestore(dto);
  }

  const sectionCount = showR2Selector ? 3 : 2;
  const backupName =
    backupInfo?.connectionName === null
      ? t("common:connection.deleted")
      : (backupInfo?.connectionName ?? "Backup");

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable sections */}
      <div className="min-h-0 flex-1 overflow-auto pr-2">
        <div className="space-y-6">
          {/* Section 1: R2 Dump or Backup Info */}
          {showR2Selector ? (
            <RestoreFormSection
              number={1}
              title={t("section.r2Dump")}
              icon={<img src={cloudflareSvg} alt="Cloudflare R2" className="h-4 w-4" />}
            >
              <R2DumpPicker
                value={selectedR2Dump ?? null}
                onChange={onR2DumpChange ?? (() => {})}
                connections={sourceConnections}
                connectionsLoading={sourceConnectionsLoading}
                disabled={isLoading}
              />
            </RestoreFormSection>
          ) : (
            <RestoreFormSection
              number={1}
              title={t("section.selectedDump")}
              icon={
                effectiveDbType && DB_LOGOS[effectiveDbType] ? (
                  <img
                    src={DB_LOGOS[effectiveDbType]}
                    alt={DB_LABELS[effectiveDbType] ?? effectiveDbType}
                    className="h-4 w-4"
                  />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )
              }
            >
              <div className="flex items-center gap-3 rounded-xl bg-muted/30 p-3">
                {effectiveDbType && DB_LOGOS[effectiveDbType] ? (
                  <img
                    src={DB_LOGOS[effectiveDbType]}
                    alt={DB_LABELS[effectiveDbType] ?? effectiveDbType}
                    className="h-6 w-6 shrink-0"
                  />
                ) : (
                  <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      backupInfo?.connectionName === null && "text-muted-foreground italic",
                    )}
                    title={backupName}
                  >
                    {backupName}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {backupInfo?.environment && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                        {backupInfo.environment}
                      </span>
                    )}
                    {backupInfo?.date && <span>{backupInfo.date}</span>}
                    {backupInfo?.fileSizeMb != null && (
                      <span>· {backupInfo.fileSizeMb.toFixed(1)} MB</span>
                    )}
                  </div>
                </div>
                {effectiveDbType && (
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full text-[10px] uppercase"
                  >
                    {DB_LABELS[effectiveDbType] ?? effectiveDbType}
                  </Badge>
                )}
              </div>
            </RestoreFormSection>
          )}

          {/* Section 2: Connection */}
          <RestoreFormSection
            number={showR2Selector ? 2 : 1}
            title={t("section.targetConnection")}
          >
            <div className="space-y-2.5">
              {!hasConnections && !connectionsLoading ? (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">
                    {effectiveDbType
                      ? t("target.noConnectionsType", { type: DB_LABELS[effectiveDbType] ?? effectiveDbType })
                      : t("target.noConnections")}
                  </span>
                  <Link
                    to="/connections"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {t("target.createConnection")}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <ConnectionSelector
                  connections={compatibleConnections}
                  value={targetConnectionId}
                  onChange={setTargetConnectionId}
                  disabled={connectionsLoading || isLoading}
                  loading={connectionsLoading}
                />
              )}

              {selectedConnection && (
                <ConnectionDetails connection={selectedConnection} isActive />
              )}
            </div>
          </RestoreFormSection>

          {/* Section 3: Options */}
          <RestoreFormSection
            number={sectionCount}
            title={t("section.options")}
            isLast
          >
            <RestoreOptions
              isDryRun={isDryRun}
              onDryRunChange={setIsDryRun}
              disabled={isLoading}
            />
          </RestoreFormSection>
        </div>
      </div>

      {/* Sticky actions at bottom */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-card px-4 pt-4 sm:-mx-6 sm:px-6">
        <RestoreActions
          canSimulate={canSimulate}
          canExecute={!!targetConnectionId && hasSource}
          isDryRun={isDryRun}
          isLoading={isLoading}
          onSimulate={handleSimulate}
          onExecute={handleExecute}
        />
      </div>
    </div>
  );
}
