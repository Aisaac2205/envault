import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { useKeyboardReadout } from "../useKeyboardReadout";

function keyEvent(key: string): KeyboardEvent {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe("useKeyboardReadout", () => {
  it("starts at the last index (the most recent day)", () => {
    const { result } = renderHook(() => useKeyboardReadout(5));
    expect(result.current.activeIndex).toBe(4);
  });

  it("ArrowLeft moves back one day, clamped at 0", () => {
    const { result } = renderHook(() => useKeyboardReadout(3));

    act(() => result.current.onKeyDown(keyEvent("ArrowLeft")));
    expect(result.current.activeIndex).toBe(1);

    act(() => result.current.onKeyDown(keyEvent("ArrowLeft")));
    expect(result.current.activeIndex).toBe(0);

    act(() => result.current.onKeyDown(keyEvent("ArrowLeft")));
    expect(result.current.activeIndex).toBe(0);
  });

  it("ArrowRight moves forward one day, clamped at length - 1", () => {
    const { result } = renderHook(() => useKeyboardReadout(3));
    act(() => result.current.setActiveIndex(0));

    act(() => result.current.onKeyDown(keyEvent("ArrowRight")));
    expect(result.current.activeIndex).toBe(1);

    act(() => result.current.onKeyDown(keyEvent("ArrowRight")));
    act(() => result.current.onKeyDown(keyEvent("ArrowRight")));
    expect(result.current.activeIndex).toBe(2);
  });

  it("Home jumps to the first day", () => {
    const { result } = renderHook(() => useKeyboardReadout(7));
    act(() => result.current.onKeyDown(keyEvent("Home")));
    expect(result.current.activeIndex).toBe(0);
  });

  it("End jumps to the last day", () => {
    const { result } = renderHook(() => useKeyboardReadout(7));
    act(() => result.current.setActiveIndex(2));
    act(() => result.current.onKeyDown(keyEvent("End")));
    expect(result.current.activeIndex).toBe(6);
  });

  it("calls preventDefault for the keys it handles", () => {
    const { result } = renderHook(() => useKeyboardReadout(7));
    const event = keyEvent("ArrowRight");
    act(() => result.current.onKeyDown(event));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("ignores unhandled keys", () => {
    const { result } = renderHook(() => useKeyboardReadout(7));
    const before = result.current.activeIndex;
    const event = keyEvent("Tab");
    act(() => result.current.onKeyDown(event));
    expect(result.current.activeIndex).toBe(before);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("re-clamps the active index when the window shrinks the day count", () => {
    const { result, rerender } = renderHook(
      ({ length }: { length: number }) => useKeyboardReadout(length),
      { initialProps: { length: 90 } },
    );
    expect(result.current.activeIndex).toBe(89);

    rerender({ length: 7 });
    expect(result.current.activeIndex).toBe(6);
  });

  it("is a no-op when there are zero days", () => {
    const { result } = renderHook(() => useKeyboardReadout(0));
    expect(result.current.activeIndex).toBe(0);
    const event = keyEvent("ArrowRight");
    act(() => result.current.onKeyDown(event));
    expect(result.current.activeIndex).toBe(0);
  });
});
