import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import i18n from '@/i18n';

await i18n.changeLanguage('es');

afterEach(() => {
  cleanup();
});

// jsdom does not implement SVG geometry. The bklit charts measure their line paths
// with getTotalLength() for the draw-in animation, so a 0 length is enough here.
if (!("getTotalLength" in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, "getTotalLength", {
    configurable: true,
    value: () => 0,
  });
}
