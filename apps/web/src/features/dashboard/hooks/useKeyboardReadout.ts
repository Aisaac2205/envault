import { useCallback, useState, type KeyboardEvent } from "react";

export interface UseKeyboardReadoutResult {
  /** Clamped to `[0, length - 1]` (or 0 when `length` is 0) even if `length` shrinks. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

function clamp(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/**
 * Single focus stop for the Trends charts: ArrowLeft/ArrowRight/Home/End move
 * one shared "active day" index. The same `DailyTooltipContent` renders for
 * this index as for the pointer-hover tooltip (identical content in both
 * modes, per the Tooltip & Keyboard Access requirement).
 */
export function useKeyboardReadout(length: number): UseKeyboardReadoutResult {
  const [rawIndex, setRawIndex] = useState(() => Math.max(length - 1, 0));
  const activeIndex = clamp(rawIndex, length);

  const setActiveIndex = useCallback((index: number) => {
    setRawIndex(index);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (length === 0) return;
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          setRawIndex((current) => clamp(clamp(current, length) - 1, length));
          break;
        case "ArrowRight":
          event.preventDefault();
          setRawIndex((current) => clamp(clamp(current, length) + 1, length));
          break;
        case "Home":
          event.preventDefault();
          setRawIndex(0);
          break;
        case "End":
          event.preventDefault();
          setRawIndex(length - 1);
          break;
        default:
          break;
      }
    },
    [length],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
