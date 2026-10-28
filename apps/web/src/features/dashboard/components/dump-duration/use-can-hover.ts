import { useSyncExternalStore } from "react";

const CAN_HOVER = "(hover: hover)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => undefined;
  }
  const query = window.matchMedia(CAN_HOVER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return window.matchMedia(CAN_HOVER).matches;
}

/**
 * True when the primary input can hover. On a touch screen a tap fires the
 * mouse events too and no `mouseleave` follows, so a hover highlight would stay
 * on the tapped legend item. There the legend only reacts to taps.
 */
export function useCanHover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
