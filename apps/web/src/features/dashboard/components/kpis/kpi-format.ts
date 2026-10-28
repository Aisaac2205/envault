import type { Change } from "./kpi-data";

/** `+1.2` / `-0.4` / `0.0`: points of a rate to one decimal, the sign shown unless it is zero. */
export function formatPointsChange(change: Change, locale: string): string {
  return new Intl.NumberFormat(locale, {
    signDisplay: "exceptZero",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(change.value);
}

/** `+24%` / `-25%` / `0%`: a share of the baseline, to whole percents. */
export function formatPercentChange(change: Change, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    maximumFractionDigits: 0,
  }).format(change.value);
}

/** `+14` / `-7` / `0`: a difference of counts. */
export function formatCountChange(change: Change, locale: string): string {
  return new Intl.NumberFormat(locale, { signDisplay: "exceptZero" }).format(change.value);
}
