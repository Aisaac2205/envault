import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    reporters: process.env.CI
      ? ['default', ['junit', { outputFile: './reports/junit.xml', addFileAttribute: true }]]
      : ['default'],
    // Coverage is opt-in (`pnpm test:coverage`); a plain `pnpm test` never collects it.
    coverage: {
      provider: 'v8',
      // Listing the sources makes files that no test imports show up at 0% instead of vanishing.
      // `.astro` pages are not listed: Vitest does not transform them, so v8 cannot measure them.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'lcovonly', 'html', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
