export interface CompactDateParts {
  /** `28 oct`, `Oct 28`; with the year (`28 oct 2025`) only for a date of another year. */
  date: string;
  /** `14:05` in Spanish, `2:05 PM` in English. */
  time: string;
}

/**
 * A date and time for a narrow column, in two parts so a column can break
 * between them (never inside either). The year shows only for a date of another
 * year, since these are recent events. Spanish gets the 24 hour clock (`14:05`),
 * which is five characters shorter than its `2:05 p. m.`. `now` is a parameter so
 * the rule can be tested.
 */
export function compactDateParts(
  date: Date | string,
  locale: string,
  now: Date = new Date(),
): CompactDateParts {
  const value = typeof date === "string" ? new Date(date) : date;
  const sameYear = value.getFullYear() === now.getFullYear();
  const english = locale.startsWith("en");
  return {
    date: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(value),
    time: new Intl.DateTimeFormat(locale, {
      hour: english ? "numeric" : "2-digit",
      minute: "2-digit",
      hourCycle: english ? "h12" : "h23",
    }).format(value),
  };
}

/** `28 oct, 14:05` / `Oct 28, 2:05 PM`: the two parts on one line. */
export function formatCompactDateTime(
  date: Date | string,
  locale: string,
  now: Date = new Date(),
): string {
  const parts = compactDateParts(date, locale, now);
  return `${parts.date}, ${parts.time}`;
}
