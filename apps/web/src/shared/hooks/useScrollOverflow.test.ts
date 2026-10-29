import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScrollOverflow } from "./useScrollOverflow";

/** Lets a test decide when the observed sizes change; jsdom has no ResizeObserver. */
class ManualObserver {
  static instances: ManualObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    ManualObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

interface Box {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

function scroller(box: Box) {
  const element = document.createElement("div");
  const content = document.createElement("table");
  element.appendChild(content);
  for (const key of Object.keys(box) as (keyof Box)[]) {
    Object.defineProperty(element, key, { configurable: true, get: () => box[key] });
  }
  return { element, content };
}

afterEach(() => {
  ManualObserver.instances = [];
  vi.unstubAllGlobals();
});

describe("useScrollOverflow", () => {
  it("reports no overflow while the content fits", () => {
    vi.stubGlobal("ResizeObserver", ManualObserver);
    const { element } = scroller({ scrollWidth: 300, clientWidth: 300, scrollHeight: 200, clientHeight: 200 });

    const { result } = renderHook(() => useScrollOverflow({ current: element }));

    expect(result.current).toBe(false);
  });

  it("reports horizontal overflow and follows later size changes", () => {
    vi.stubGlobal("ResizeObserver", ManualObserver);
    const box = { scrollWidth: 520, clientWidth: 328, scrollHeight: 200, clientHeight: 200 };
    const { element } = scroller(box);

    const { result } = renderHook(() => useScrollOverflow({ current: element }));
    expect(result.current).toBe(true);

    box.scrollWidth = 328;
    act(() => ManualObserver.instances[0].notify());
    expect(result.current).toBe(false);
  });

  it("reports vertical overflow for panes that scroll down", () => {
    vi.stubGlobal("ResizeObserver", ManualObserver);
    const { element } = scroller({ scrollWidth: 300, clientWidth: 300, scrollHeight: 900, clientHeight: 400 });

    const { result } = renderHook(() => useScrollOverflow({ current: element }));

    expect(result.current).toBe(true);
  });

  it("ignores a one pixel rounding difference", () => {
    vi.stubGlobal("ResizeObserver", ManualObserver);
    const { element } = scroller({ scrollWidth: 301, clientWidth: 300, scrollHeight: 200, clientHeight: 200 });

    const { result } = renderHook(() => useScrollOverflow({ current: element }));

    expect(result.current).toBe(false);
  });

  it("watches both the scroller and its content, and stops on unmount", () => {
    vi.stubGlobal("ResizeObserver", ManualObserver);
    const { element, content } = scroller({ scrollWidth: 300, clientWidth: 300, scrollHeight: 200, clientHeight: 200 });

    const { unmount } = renderHook(() => useScrollOverflow({ current: element }));
    const observer = ManualObserver.instances[0];
    expect(observer.observed).toEqual([element, content]);

    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it("measures once when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { element } = scroller({ scrollWidth: 520, clientWidth: 328, scrollHeight: 200, clientHeight: 200 });

    const { result } = renderHook(() => useScrollOverflow({ current: element }));

    expect(result.current).toBe(true);
  });

  it("reports no overflow without an element", () => {
    const { result } = renderHook(() => useScrollOverflow({ current: null }));

    expect(result.current).toBe(false);
  });
});
