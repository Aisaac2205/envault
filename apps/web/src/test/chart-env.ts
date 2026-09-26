import { afterEach, vi } from 'vitest';

/**
 * The vendored bklit charts (src/shared/ui/charts) size themselves via
 * `@visx/responsive`'s `ParentSize`, which reads the container's
 * `getBoundingClientRect()` through a `ResizeObserver`. jsdom always reports
 * 0x0, so every chart test must mock a concrete size before mounting.
 *
 * Both mocks restore themselves automatically in `afterEach` — call
 * `mockChartSize`/`mockReducedMotion` again per-test rather than once per file.
 */

let restoreRect: (() => void) | null = null;
let restoreResizeObserver: (() => void) | null = null;
let restoreMatchMedia: (() => void) | null = null;

/**
 * Mock `Element.prototype.getBoundingClientRect` AND `ResizeObserver` to a
 * fixed width/height. `@visx/responsive`'s `ParentSize` (which every
 * vendored chart uses) reads size exclusively from `ResizeObserver`'s
 * `entry.contentRect`, not from `getBoundingClientRect` directly — jsdom's
 * default 0x0 report means charts stay unmounted (`width|height < 10`)
 * unless the observer fires with a real size on `observe()`.
 */
export function mockChartSize(width: number, height: number): void {
  restoreRect?.();
  restoreResizeObserver?.();

  const originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  })) as typeof Element.prototype.getBoundingClientRect;
  restoreRect = () => {
    Element.prototype.getBoundingClientRect = originalRect;
    restoreRect = null;
  };

  const originalResizeObserver = globalThis.ResizeObserver;
  class MockResizeObserver implements ResizeObserver {
    #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe(target: Element) {
      // Real ResizeObservers fire once, asynchronously, on `observe()`.
      queueMicrotask(() => {
        this.#callback(
          [
            {
              target,
              contentRect: { width, height, top: 0, left: 0, x: 0, y: 0, right: width, bottom: height } as DOMRectReadOnly,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this
        );
      });
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MockResizeObserver;
  window.ResizeObserver = MockResizeObserver;
  restoreResizeObserver = () => {
    globalThis.ResizeObserver = originalResizeObserver;
    window.ResizeObserver = originalResizeObserver;
    restoreResizeObserver = null;
  };
}

/** Mock `window.matchMedia('(prefers-reduced-motion: reduce)')`. */
export function mockReducedMotion(reduced: boolean): void {
  restoreMatchMedia?.();
  const original = window.matchMedia;
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = original;
    restoreMatchMedia = null;
  };
}

afterEach(() => {
  restoreRect?.();
  restoreResizeObserver?.();
  restoreMatchMedia?.();
});
