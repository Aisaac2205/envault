/**
 * Completed over completed plus failed, as a 0 to 1 fraction. A day with
 * neither has no rate (`null`): it is neither 0% nor 100%.
 */
export function successRate(completed: number, failed: number): number | null {
  const finished = completed + failed;
  return finished === 0 ? null : completed / finished;
}

/**
 * A rate for the screen: `96%`, `66.6%`, or `—` without one. It rounds down to a
 * tenth, so one failure in 250 backups reads 99.6%, never a perfect 100%.
 */
export function formatRate(rate: number | null, locale: string): string {
  if (rate === null) {
    return "—";
  }
  // The epsilon keeps 0.29 * 1000 = 289.99999999999994 from losing a tenth.
  const floored = Math.floor(rate * 1000 + 1e-9) / 1000;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(floored);
}

export function formatCount(count: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(count);
}
