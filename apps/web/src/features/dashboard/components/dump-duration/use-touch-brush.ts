import { useSyncExternalStore } from "react";

const COARSE_POINTER = "(pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => undefined;
  }
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(COARSE_POINTER).matches;
}

/**
 * True when the primary pointer is a finger. The brush normally follows the
 * cursor through `mousemove` on the window, which never fires for a touch drag;
 * on a touch screen it has to listen for pointer events on the brush itself.
 * With a mouse the window listeners stay, because a drag must keep working when
 * the cursor leaves the strip.
 */
export function useTouchBrush(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
