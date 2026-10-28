import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCanHover } from "../dump-duration/use-can-hover";

type ChangeListener = () => void;

/** A `matchMedia` whose `(hover: hover)` answer can change after mount. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<ChangeListener>();
  const query = {
    matches: initial,
    addEventListener: vi.fn((_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    }),
  };
  const matchMedia = vi.fn().mockReturnValue(query);
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    matchMedia,
    query,
    listeners,
    /** Plug a mouse in or out: the answer flips and the listeners are told. */
    change(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe("useCanHover", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true on a device whose primary input can hover", () => {
    const media = stubMatchMedia(true);

    expect(renderHook(() => useCanHover()).result.current).toBe(true);
    expect(media.matchMedia).toHaveBeenCalledWith("(hover: hover)");
  });

  it("is false on a touch only device, so the legend reacts to taps only", () => {
    stubMatchMedia(false);

    expect(renderHook(() => useCanHover()).result.current).toBe(false);
  });

  it("is true where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);

    expect(renderHook(() => useCanHover()).result.current).toBe(true);
  });

  it("follows the media query when the primary input changes", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useCanHover());
    expect(result.current).toBe(false);

    act(() => media.change(true));
    expect(result.current).toBe(true);

    act(() => media.change(false));
    expect(result.current).toBe(false);
  });

  it("stops listening when the component unmounts", () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useCanHover());
    expect(media.listeners.size).toBe(1);

    unmount();

    expect(media.query.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.listeners.size).toBe(0);
  });
});
