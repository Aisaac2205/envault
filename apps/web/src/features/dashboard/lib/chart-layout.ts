import i18n from "@/i18n";

const getLocale = (): string => (i18n.language?.startsWith("en") ? "en-US" : "es-AR");

/**
 * Constant reveal signature for the mount-only 150ms motion. Never key by
 * window — a window change must NOT replay the entrance animation.
 */
export const CHART_REVEAL_SIGNATURE = "envault-dashboard";

export interface RevealDurationInput {
  reducedMotion: boolean;
  hasRevealed: boolean;
}

/** 150ms on first mount only; 0 for reduced motion or any later render (refetch, window change). */
export function revealDuration({ reducedMotion, hasRevealed }: RevealDurationInput): 0 | 150 {
  if (reducedMotion || hasRevealed) return 0;
  return 150;
}

export type DurationUnit = "s" | "min" | "h";

export function pickDurationUnit(maxSeconds: number): DurationUnit {
  if (maxSeconds < 60) return "s";
  if (maxSeconds < 3600) return "min";
  return "h";
}

export function formatDurationValue(seconds: number, unit: DurationUnit): string {
  if (unit === "s") return `${Math.round(seconds)}s`;
  if (unit === "min") return `${(seconds / 60).toFixed(1)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** "—" for a null duration — never interpolated to 0 (Duration Chart requirement). */
export function formatDurationCell(seconds: number | null): string {
  if (seconds === null) return "—";
  return formatDurationValue(seconds, pickDurationUnit(seconds));
}

/** Outcome 112 / duration 88 / size 64 plot px — height encodes panel priority. */
export const DAILY_PANEL_HEIGHTS = { outcome: 112, duration: 88, size: 64 } as const;

export interface DailyMarginOptions {
  /** Below @xl/trends: no room for end labels, so the right margin shrinks. */
  compact?: boolean;
  /** Only the bottom-most panel carries the shared x-axis. */
  bottomPanel?: boolean;
}

export function getDailyMargin({ compact = false, bottomPanel = false }: DailyMarginOptions = {}) {
  return {
    top: 4,
    right: compact ? 8 : 48,
    bottom: bottomPanel ? 20 : 0,
    left: 40,
  };
}

function utcDateFromIso(dateIso: string): Date {
  // Date-only ISO strings (`YYYY-MM-DD`) are already parsed as UTC midnight by
  // the spec; being explicit here documents the intent alongside the
  // `timeZone: "UTC"` formatter options below.
  return new Date(`${dateIso}T00:00:00Z`);
}

/**
 * Compact x-axis tick label (e.g. "Mar 1"). Always formatted in UTC so a
 * reader in UTC-6 never sees the previous day (design §10: "off-by-one in
 * UTC-6").
 */
export function formatUtcTickDate(dateIso: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(utcDateFromIso(dateIso));
}

/**
 * Full date label for tooltips, the keyboard readout and the accessible
 * table — always UTC, see {@link formatUtcTickDate}.
 */
export function formatUtcFullDate(dateIso: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utcDateFromIso(dateIso));
}
