import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APP_CONFIG } from "@/config";
import type { BackupJob, JobStatus } from "../types";
import {
  MAX_CONCURRENT_STREAMS,
  MAX_STREAM_ATTEMPTS,
  markBackupCancelled,
  unmarkBackupCancelled,
  useBackupStreams,
} from "./useBackupStreams";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

/** Minimal stand-in for the browser EventSource, driven by the tests. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

function openFor(jobId: string): FakeEventSource[] {
  return FakeEventSource.instances.filter(
    (s) => s.url.endsWith(`/backups/${jobId}/stream`) && !s.closed,
  );
}

function allFor(jobId: string): FakeEventSource[] {
  return FakeEventSource.instances.filter((s) =>
    s.url.endsWith(`/backups/${jobId}/stream`),
  );
}

function job(id: string, status: JobStatus): BackupJob {
  return {
    id,
    connectionId: "c-1",
    connectionName: "Ventas",
    environment: "prod",
    dbType: "postgres",
    status,
    fileKey: null,
    fileSizeMb: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    triggeredBy: "manual",
    createdAt: "2026-10-22T00:00:00Z",
  };
}

function setup(initialJobs: BackupJob[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ jobs }: { jobs: BackupJob[] }) => useBackupStreams(jobs),
    { wrapper, initialProps: { jobs: initialJobs } },
  );
  const dumpsInvalidations = () =>
    invalidate.mock.calls.filter(
      ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(["dumps"]),
    ).length;
  return { ...hook, invalidate, dumpsInvalidations };
}

describe("useBackupStreams", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribes to pending and running jobs only, with credentials", () => {
    setup([
      job("j-pending", "pending"),
      job("j-running", "running"),
      job("j-done", "completed"),
      job("j-failed", "failed"),
    ]);

    expect(FakeEventSource.instances.map((s) => s.url)).toEqual([
      `${APP_CONFIG.apiBaseUrl}/backups/j-pending/stream`,
      `${APP_CONFIG.apiBaseUrl}/backups/j-running/stream`,
    ]);
    expect(FakeEventSource.instances.every((s) => s.withCredentials)).toBe(true);
  });

  it("does not subscribe or toast for jobs that were already terminal", () => {
    const { dumpsInvalidations } = setup([job("j-done", "completed"), job("j-failed", "failed")]);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(dumpsInvalidations()).toBe(0);
  });

  it("closes the stream, toasts and invalidates dumps when the job completes", () => {
    const { dumpsInvalidations } = setup([job("j-1", "running")]);
    const [source] = openFor("j-1");

    act(() => {
      source.emit({ type: "completed", payload: { jobId: "j-1", completedAt: "2026-10-22T00:01:00Z" } });
    });

    expect(source.closed).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith("Respaldo completado");
    expect(toastError).not.toHaveBeenCalled();
    expect(dumpsInvalidations()).toBe(1);
  });

  it("closes the stream and toasts the reason when the job fails", () => {
    const { dumpsInvalidations } = setup([job("j-1", "pending")]);
    const [source] = openFor("j-1");
    const error = 'No se pudo conectar a la base de origen "Ventas": read ECONNRESET';

    act(() => {
      source.emit({ type: "failed", payload: { jobId: "j-1", error } });
    });

    expect(source.closed).toBe(true);
    expect(toastError).toHaveBeenCalledWith(`El respaldo falló: ${error}`);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(dumpsInvalidations()).toBe(1);
  });

  it("closes and invalidates without the failure toast for a job cancelled from this tab", () => {
    const { dumpsInvalidations } = setup([job("j-1", "running"), job("j-2", "running")]);
    markBackupCancelled("j-1");

    act(() => {
      openFor("j-1")[0].emit({ type: "failed", payload: { jobId: "j-1", error: "Respaldo cancelado" } });
    });

    expect(allFor("j-1")[0].closed).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
    expect(dumpsInvalidations()).toBe(1);

    // Other jobs, and a cancel that was rolled back, still toast real failures.
    markBackupCancelled("j-2");
    unmarkBackupCancelled("j-2");
    act(() => {
      openFor("j-2")[0].emit({ type: "failed", payload: { jobId: "j-2", error: "boom" } });
    });
    expect(toastError).toHaveBeenCalledWith("El respaldo falló: boom");
  });

  it("keeps the stream open without toasting on progress and retry logs", () => {
    const { dumpsInvalidations } = setup([job("j-1", "running")]);
    const [source] = openFor("j-1");

    act(() => {
      source.emit({ type: "progress", payload: { percent: 40 } });
      source.emit({
        type: "log",
        payload: {
          message: "Intento 1 de 2 falló: read ECONNRESET. Reintentando...",
          timestamp: "2026-10-22T00:00:30Z",
        },
      });
    });

    expect(source.closed).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(dumpsInvalidations()).toBe(0);
  });

  it("ignores messages that are not valid JSON", () => {
    setup([job("j-1", "running")]);
    const [source] = openFor("j-1");

    act(() => {
      source.onmessage?.(new MessageEvent("message", { data: "not json" }));
    });

    expect(source.closed).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("closes once and invalidates once when the stream ends without a terminal event", () => {
    const { rerender, dumpsInvalidations } = setup([job("j-1", "running")]);
    const [source] = openFor("j-1");

    act(() => {
      source.fail();
      source.fail();
    });

    expect(source.closed).toBe(true);
    expect(dumpsInvalidations()).toBe(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();

    // A refetch that still lists the job as running must not reopen it in a loop.
    rerender({ jobs: [job("j-1", "running")] });
    expect(allFor("j-1")).toHaveLength(1);
  });

  it(`gives up on a job after ${MAX_STREAM_ATTEMPTS} streams that ended without a terminal event`, () => {
    const { rerender } = setup([job("j-1", "running")]);

    for (let i = 0; i < MAX_STREAM_ATTEMPTS + 2; i++) {
      act(() => {
        openFor("j-1").forEach((s) => s.fail());
      });
      // Another job appearing changes the active set, which re-syncs the streams.
      rerender({ jobs: [job("j-1", "running"), job(`other-${i}`, "pending")] });
    }

    expect(allFor("j-1")).toHaveLength(MAX_STREAM_ATTEMPTS);
  });

  it("closes every open stream on unmount", () => {
    const { unmount } = setup([job("j-1", "running"), job("j-2", "pending")]);
    expect(FakeEventSource.instances).toHaveLength(2);

    unmount();

    expect(FakeEventSource.instances.every((s) => s.closed)).toBe(true);
  });

  it(`opens at most ${MAX_CONCURRENT_STREAMS} streams and fills freed slots`, () => {
    const jobs = Array.from({ length: MAX_CONCURRENT_STREAMS + 2 }, (_, i) =>
      job(`j-${i}`, "running"),
    );
    const { rerender } = setup(jobs);

    expect(FakeEventSource.instances).toHaveLength(MAX_CONCURRENT_STREAMS);
    expect(openFor(`j-${MAX_CONCURRENT_STREAMS}`)).toHaveLength(0);

    act(() => {
      openFor("j-0")[0].emit({ type: "completed", payload: { jobId: "j-0", completedAt: "now" } });
    });
    rerender({ jobs: [job("j-0", "completed"), ...jobs.slice(1)] });

    expect(FakeEventSource.instances.filter((s) => !s.closed)).toHaveLength(MAX_CONCURRENT_STREAMS);
    expect(openFor(`j-${MAX_CONCURRENT_STREAMS}`)).toHaveLength(1);
  });

  it("tracks a job triggered from this tab before it shows up in the history", () => {
    const { result, rerender } = setup([]);

    act(() => {
      result.current.track("j-new");
    });
    expect(openFor("j-new")).toHaveLength(1);

    // The refetch that lists the new pending row must not open a duplicate.
    rerender({ jobs: [job("j-new", "pending")] });
    act(() => {
      result.current.track("j-new");
    });
    expect(allFor("j-new")).toHaveLength(1);
  });

  it("does not resubscribe to a job after its terminal event while the history is stale", () => {
    const { rerender } = setup([job("j-1", "running")]);

    act(() => {
      openFor("j-1")[0].emit({ type: "completed", payload: { jobId: "j-1", completedAt: "now" } });
    });
    rerender({ jobs: [job("j-1", "running"), job("j-2", "pending")] });

    expect(allFor("j-1")).toHaveLength(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});
