import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import i18n from '@/i18n';

await i18n.changeLanguage('es');

// dashboard-charts-web: jsdom ships none of these SVG/layout APIs, and the
// vendored bklit charts (src/shared/ui/charts) call them unconditionally.
// Guarded so re-running setup (or other suites patching the same globals)
// never clobbers an already-present implementation.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class MockResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MockResizeObserver;
}

if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom exposes every SVG child element as a plain `SVGElement` instance —
// there is no distinct `SVGTextContentElement`/`SVGGraphicsElement`/
// `SVGGeometryElement` runtime class to patch, so we widen the prototype
// through those (more specific, SVGElement-extending) lib.dom interfaces
// instead of casting through `any`/`unknown`.
const svgTextProto = SVGElement.prototype as SVGTextContentElement;
if (typeof svgTextProto.getComputedTextLength === 'undefined') {
  svgTextProto.getComputedTextLength = () => 0;
}

const svgGraphicsProto = SVGElement.prototype as SVGGraphicsElement;
if (typeof svgGraphicsProto.getBBox === 'undefined') {
  // Minimal DOMRect-shaped stub — only `width`/`height` are read by the charts.
  svgGraphicsProto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}

const svgGeometryProto = SVGElement.prototype as SVGGeometryElement;
if (typeof svgGeometryProto.getTotalLength === 'undefined') {
  // Used by the vendored line-path stroke-metrics logic (dash tail overlays).
  svgGeometryProto.getTotalLength = () => 0;
}

afterEach(() => {
  cleanup();
});