import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionRetentionApi } from "../api/connection-retention-api";
import { useConnections } from "@/features/connections/hooks/useConnections";
import { BACKUP_CATEGORIES } from "@/types/backup.types";
import type { BackupCategory } from "@/types/backup.types";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  ConnectionRetentionPolicyInput,
  RetentionPreviewItem,
  RetentionRunItem,
} from "../types";

const QUERY_KEY = ["connection-retention"] as const;

export type RetentionPreset = "7" | "14" | "30" | "90" | "unlimited" | "custom";

export function useRetentionPolicies(connectionSlug: string) {
  return useQuery({
    queryKey: [...QUERY_KEY, connectionSlug, "policies"],
    queryFn: () => connectionRetentionApi.getPolicies(connectionSlug),
    enabled: connectionSlug !== "",
    staleTime: 30_000,
  });
}

export function useUpdateRetentionPolicies(connectionSlug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (policies: ConnectionRetentionPolicyInput[]) =>
      connectionRetentionApi.updatePolicies(connectionSlug, policies),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...QUERY_KEY, connectionSlug],
      });
      void queryClient.invalidateQueries({ queryKey: ["storage-overview"] });
    },
  });
}

export function useRetentionPreview(connectionSlug: string) {
  return useQuery<RetentionPreviewItem[]>({
    queryKey: [...QUERY_KEY, connectionSlug, "preview"],
    queryFn: () => connectionRetentionApi.getPreview(connectionSlug),
    enabled: connectionSlug !== "",
    staleTime: 15_000,
  });
}

export function useRunRetention(connectionSlug: string) {
  const queryClient = useQueryClient();

  return useMutation<RetentionRunItem[], Error>({
    mutationFn: () => connectionRetentionApi.runCleanup(connectionSlug),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...QUERY_KEY, connectionSlug, "preview"],
      });
      void queryClient.invalidateQueries({ queryKey: ["storage-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["dumps"] });
      void queryClient.invalidateQueries({ queryKey: ["r2-dumps"] });
    },
  });
}

export interface RowState {
  category: BackupCategory;
  keepForever: boolean;
  days: string;
}

function buildInitialRows(
  policies: { category: BackupCategory; retentionDays: number | null }[],
): RowState[] {
  const byCategory = new Map(
    policies.map((p) => [p.category, p.retentionDays]),
  );

  return BACKUP_CATEGORIES.map((category) => {
    const days = byCategory.get(category);
    return {
      category,
      keepForever: days == null,
      days: days?.toString() ?? "30",
    };
  });
}

function computeActivePreset(rows: RowState[]): RetentionPreset {
  if (rows.length === 0) return "custom";
  const allKeepForever = rows.every((r) => r.keepForever);
  if (allKeepForever) return "unlimited";

  const anyKeepForever = rows.some((r) => r.keepForever);
  if (anyKeepForever) return "custom";

  const firstDays = rows[0]?.days;
  const allSameDays = rows.every((r) => r.days === firstDays);
  if (!allSameDays) return "custom";

  if (firstDays === "7") return "7";
  if (firstDays === "14") return "14";
  if (firstDays === "30") return "30";
  if (firstDays === "90") return "90";

  return "custom";
}

export function useConnectionRetention(connectionSlug: string) {
  const { t } = useTranslation("cleanup");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const {
    data: policies = [],
    isLoading: policiesLoading,
    isError: policiesError,
    error: policiesErrorObj,
  } = useRetentionPolicies(connectionSlug);

  const { data: preview = [], isLoading: previewLoading } =
    useRetentionPreview(connectionSlug);

  const updatePolicies = useUpdateRetentionPolicies(connectionSlug);
  const runRetention = useRunRetention(connectionSlug);

  const [rows, setRows] = useState<RowState[]>(() =>
    buildInitialRows(policies),
  );

  const policyKey = useMemo(
    () => `${connectionSlug}-${policies.map((p) => p.category + p.retentionDays).join(",")}`,
    [connectionSlug, policies],
  );

  const [prevPolicyKey, setPrevPolicyKey] = useState<string>("");

  if (policyKey !== prevPolicyKey) {
    setPrevPolicyKey(policyKey);
    setRows(buildInitialRows(policies));
    setValidationError(null);
  }

  const activePreset = useMemo(() => computeActivePreset(rows), [rows]);

  const applyPreset = (preset: "7" | "14" | "30" | "90" | "unlimited") => {
    if (preset === "unlimited") {
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          keepForever: true,
        })),
      );
    } else {
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          keepForever: false,
          days: preset,
        })),
      );
    }
    setValidationError(null);
  };

  const updateRow = (category: BackupCategory, patch: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => (r.category === category ? { ...r, ...patch } : r)),
    );
    setValidationError(null);
  };

  const handleSave = async (): Promise<boolean> => {
    for (const row of rows) {
      if (row.keepForever) continue;
      const parsed = Number(row.days);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setValidationError(
          t("toast.policyValidation", { category: t(`category.${row.category}`) }),
        );
        return false;
      }
    }

    const payload: ConnectionRetentionPolicyInput[] = rows.map((row) => ({
      category: row.category,
      retentionDays: row.keepForever ? null : Number(row.days),
    }));

    try {
      await updatePolicies.mutateAsync(payload);
      toast.success(t("toast.policySaved"), {
        description: t("toast.policySavedDesc"),
      });
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("toast.policyError");
      toast.error(t("toast.policyError"), { description: message });
      return false;
    }
  };

  const handleRunCleanup = async () => {
    try {
      const summary = await runRetention.mutateAsync();
      const deleted = summary.reduce((s, i) => s + i.deleted, 0);
      const freed = summary.reduce((s, i) => s + i.freedMb, 0);
      const errors = summary.reduce((s, i) => s + i.errors, 0);
      toast.success(t("toast.cleanupExecuted"), {
        description: t("toast.cleanupExecutedDesc", {
          deleted,
          freed: freed.toFixed(2),
          errors: errors > 0 ? t("toast.cleanupExecutedErrors", { count: errors }) : "",
        }),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("toast.cleanupRunError");
      toast.error(t("toast.cleanupRunError"), { description: message });
    } finally {
      setConfirmOpen(false);
    }
  };

  const prunable = preview.filter((i) => i.count > 0);
  const totalCount = prunable.reduce((s, i) => s + i.count, 0);
  const totalMb = prunable.reduce((s, i) => s + i.totalSizeMb, 0);

  const isDirty = useMemo(() => {
    const saved = new Map(
      policies.map((p) => [p.category, p.retentionDays]),
    );
    for (const row of rows) {
      const savedDays = saved.get(row.category);
      if (row.keepForever && savedDays != null) return true;
      if (!row.keepForever && savedDays == null) return true;
      if (!row.keepForever && savedDays != null) {
        if (savedDays !== Number(row.days)) return true;
      }
    }
    return false;
  }, [rows, policies]);

  const hasSavedPolicy = policies.some((p) => p.retentionDays != null);

  return {
    policies,
    isLoading: policiesLoading,
    isError: policiesError,
    error: policiesErrorObj,
    rows,
    activePreset,
    applyPreset,
    updateRow,
    handleSave,
    handleRunCleanup,
    isDirty,
    hasSavedPolicy,
    prunable,
    totalCount,
    totalMb,
    previewLoading,
    isSaving: updatePolicies.isPending,
    isRunning: runRetention.isPending,
    confirmOpen,
    setConfirmOpen,
    validationError,
  };
}

export function useConnectionRetentionPanel() {
  const { data: connections = [], isLoading: connectionsLoading } =
    useConnections();
  const [connectionSlug, setConnectionSlug] = useState<string>("");

  const retention = useConnectionRetention(connectionSlug);

  return {
    ...retention,
    connections,
    connectionsLoading,
    connectionSlug,
    setConnectionSlug,
    connectionSelected: connectionSlug !== "",
    isLoading: connectionsLoading || retention.isLoading,
    policiesError: retention.isError,
    policiesErrorObj: retention.error,
  };
}
