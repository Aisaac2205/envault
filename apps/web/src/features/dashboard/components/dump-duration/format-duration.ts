const MISSING = "—";

const decimalFormats = new Map<string, Intl.NumberFormat>();

function formatOneDecimal(value: number, locale: string): string {
  let format = decimalFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    decimalFormats.set(locale, format);
  }
  return format.format(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Human readable dump duration: `850 ms`, `12.4 s`, `2 m 05 s`, `1 h 02 m`.
 * A missing value is an em dash, never 0. Each unit rolls over on the rounded
 * value, so 0.9996 s reads `1.0 s` and 59.96 s reads `1 m 00 s`.
 */
export function formatDuration(
  seconds: number | null | undefined,
  locale = "en-US",
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return MISSING;
  }

  const value = Math.max(0, seconds);

  const milliseconds = Math.round(value * 1000);
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }

  const tenths = Math.round(value * 10);
  if (tenths < 600) {
    return `${formatOneDecimal(tenths / 10, locale)} s`;
  }

  const total = Math.round(value);
  if (total < 3600) {
    return `${Math.floor(total / 60)} m ${pad(total % 60)} s`;
  }

  return `${Math.floor(total / 3600)} h ${pad(Math.floor((total % 3600) / 60))} m`;
}

/** Compact variant for axis ticks: `5 s` instead of `5.0 s`, `1 m` instead of `1 m 00 s`. */
export function formatAxisDuration(seconds: number, locale = "en-US"): string {
  if (seconds === 0) {
    return "0";
  }
  return formatDuration(seconds, locale)
    .replace(/^(\d+)[.,]0 s$/, "$1 s")
    .replace(/ 00 [sm]$/, "");
}
