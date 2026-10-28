import { useCallback, useState } from "react";
import {
  DEFAULT_RANGE_DAYS,
  QUICK_RANGE_DAYS,
  type QuickRangeDays,
} from "../components/dump-duration/dump-duration-data";

/** Where the dump duration chart keeps its range. */
export const DURATION_RANGE_KEY = "vaultly:dashboard:duration-range";
/** Where the Connection status card keeps its window. */
export const HEALTH_RANGE_KEY = "vaultly:dashboard:health-range";

/**
 * The stored range, when it is one of the quick ranges spelled exactly as this
 * hook writes it ("7", "30", "90"). Anything else, an unreadable storage
 * included, is the default.
 */
function readRange(key: string): QuickRangeDays {
  try {
    const stored = localStorage.getItem(key);
    return QUICK_RANGE_DAYS.find((days) => String(days) === stored) ?? DEFAULT_RANGE_DAYS;
  } catch {
    // Storage disabled or blocked (private mode, a sandboxed frame): open on the default.
    return DEFAULT_RANGE_DAYS;
  }
}

/**
 * A quick range that outlives the page: the card opens on the range it was left
 * on. Each card passes its own key, so each remembers its own choice. The storage
 * is read once, on mount, and written only when a range is picked; a storage that
 * throws never breaks the card, it just forgets.
 */
export function useStoredRange(key: string): [QuickRangeDays, (days: QuickRangeDays) => void] {
  const [days, setDays] = useState<QuickRangeDays>(() => readRange(key));

  const select = useCallback(
    (next: QuickRangeDays) => {
      setDays(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Storage full or blocked: the range still applies, it is just not remembered.
      }
    },
    [key],
  );

  return [days, select];
}
