import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { APP_CONFIG } from "@/config";
import type { BackupJob } from "../types";

/** Upper bound of EventSource connections this page keeps open at once. */
export const MAX_CONCURRENT_STREAMS = 5;

/**
 * Streams opened per job before giving up. A stream that ends without a
 * terminal event (expired replay, unknown job, network drop) is not reopened
 * until the set of active jobs changes, and never more than this many times,
 * so a row stuck as running can not turn into a reconnect loop.
 */
export const MAX_STREAM_ATTEMPTS = 3;

/**
 * Jobs the user cancelled from this tab. The server reports a cancel as a
 * terminal `failed`; for these the stream still closes and the queries
 * refresh, but the "backup failed" toast is skipped (the cancel already
 * toasted). Module-level so row actions can mark a job without prop drilling.
 */
const cancelledJobIds = new Set<string>();

/** Call before requesting the cancel: the `failed` event can beat the HTTP response. */
export function markBackupCancelled(jobId: string): void {
  cancelledJobIds.add(jobId);
}

/** Call when the cancel request failed, so a later real failure still toasts. */
export function unmarkBackupCancelled(jobId: string): void {
  cancelledJobIds.delete(jobId);
}

type BackupStreamEvent =
  | { type: "progress"; payload: { percent: number } }
  | { type: "log"; payload: { message: string; timestamp: string } }
  | { type: "completed"; payload: { jobId: string; completedAt: string } }
  | { type: "failed"; payload: { jobId: string; error: string } };

interface UseBackupStreamsReturn {
  /** Starts following a job this tab has just triggered. */
  track: (jobId: string) => void;
}

export function backupStreamUrl(jobId: string): string {
  return `${APP_CONFIG.apiBaseUrl}/backups/${encodeURIComponent(jobId)}/stream`;
}

function parseEvent(raw: unknown): BackupStreamEvent | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      return parsed as BackupStreamEvent;
    }
  } catch {
    // Malformed frames are ignored; the terminal event still closes the stream.
  }
  return null;
}

function isActive(job: BackupJob): boolean {
  return job.status === "pending" || job.status === "running";
}

/**
 * Follows the SSE stream of every backup that is still pending or running in
 * the visible history, plus the ones triggered from this tab, and refreshes
 * the dumps queries when they finish. Jobs that were already terminal when
 * first seen are never subscribed to, so they never toast.
 */
export function useBackupStreams(jobs: BackupJob[]): UseBackupStreamsReturn {
  const { t } = useTranslation("dumps");
  const queryClient = useQueryClient();

  const streamsRef = useRef(new Map<string, EventSource>());
  const finishedRef = useRef(new Set<string>());
  const attemptsRef = useRef(new Map<string, number>());
  const triggeredRef = useRef<string[]>([]);
  const activeIdsRef = useRef<string[]>([]);

  // A string key keeps the sync effect from re-running on every refetch that
  // returns a new array with the same active jobs.
  const activeKey = useMemo(
    () => jobs.filter(isActive).map((j) => j.id).join(","),
    [jobs],
  );

  const refreshQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["dumps"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient]);

  const open = useCallback(
    (jobId: string) => {
      const streams = streamsRef.current;
      const source = new EventSource(backupStreamUrl(jobId), {
        withCredentials: true,
      });
      streams.set(jobId, source);

      const isCurrent = () => streams.get(jobId) === source;
      const close = () => {
        source.close();
        if (isCurrent()) streams.delete(jobId);
      };

      source.onmessage = (message: MessageEvent) => {
        if (!isCurrent()) return;
        const event = parseEvent(message.data);
        if (!event) return;

        if (event.type === "completed") {
          finishedRef.current.add(jobId);
          close();
          toast.success(t("toast.completed"));
          refreshQueries();
        } else if (event.type === "failed") {
          finishedRef.current.add(jobId);
          close();
          if (!cancelledJobIds.delete(jobId)) {
            toast.error(t("toast.failed", { error: event.payload.error }));
          }
          refreshQueries();
        }
        // `progress` and `log` (including retry notices) keep the stream open.
      };

      // The server ended the stream without a terminal event, or the network
      // failed. Close it explicitly: a native EventSource would otherwise
      // reconnect and replay the job history in a loop.
      source.onerror = () => {
        if (!isCurrent()) return;
        close();
        refreshQueries();
      };
    },
    [t, refreshQueries],
  );

  const sync = useCallback(() => {
    const streams = streamsRef.current;
    const candidates = [...triggeredRef.current, ...activeIdsRef.current];
    for (const jobId of candidates) {
      if (streams.size >= MAX_CONCURRENT_STREAMS) break;
      if (streams.has(jobId) || finishedRef.current.has(jobId)) continue;
      const attempts = attemptsRef.current.get(jobId) ?? 0;
      if (attempts >= MAX_STREAM_ATTEMPTS) continue;
      attemptsRef.current.set(jobId, attempts + 1);
      open(jobId);
    }
  }, [open]);

  useEffect(() => {
    activeIdsRef.current = activeKey ? activeKey.split(",") : [];
    sync();
  }, [activeKey, sync]);

  useEffect(() => {
    const streams = streamsRef.current;
    const attempts = attemptsRef.current;
    return () => {
      for (const source of streams.values()) source.close();
      streams.clear();
      // Forget the attempts so a remount (StrictMode) can reopen the streams.
      attempts.clear();
    };
  }, []);

  const track = useCallback(
    (jobId: string) => {
      if (!triggeredRef.current.includes(jobId)) {
        triggeredRef.current = [...triggeredRef.current, jobId];
      }
      sync();
    },
    [sync],
  );

  return { track };
}
