import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTouchBrush } from "../dump-duration/use-touch-brush";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe("useTouchBrush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when the primary pointer is a finger", () => {
    stubMatchMedia(true);

    expect(renderHook(() => useTouchBrush()).result.current).toBe(true);
  });

  it("is false with a mouse, so the brush keeps following the window", () => {
    stubMatchMedia(false);

    expect(renderHook(() => useTouchBrush()).result.current).toBe(false);
  });

  it("is false where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);

    expect(renderHook(() => useTouchBrush()).result.current).toBe(false);
  });
});
