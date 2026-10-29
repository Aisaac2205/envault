import { useEffect, useState, type RefObject } from "react";

/** Sub-pixel layout can leave a 1px difference that is not a real overflow. */
const TOLERANCE_PX = 1;

function overflows(element: HTMLElement): boolean {
  return (
    element.scrollWidth - element.clientWidth > TOLERANCE_PX ||
    element.scrollHeight - element.clientHeight > TOLERANCE_PX
  );
}

/**
 * Reports whether a scroll container's content is larger than its box, in
 * either axis. A scroll region uses it to join the tab order (tabIndex 0)
 * only while there is something to scroll: keyboard users can then reach
 * and scroll it, and nobody tabs onto a region that does nothing.
 *
 * It watches the container and its direct children, so a resize of the
 * viewport and a change of the content (new rows, a reflow) both count.
 */
export function useScrollOverflow(ref: RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => setOverflowing(overflows(element));
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref]);

  return overflowing;
}
