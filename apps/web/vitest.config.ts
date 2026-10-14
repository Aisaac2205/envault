import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Coverage is opt-in (`pnpm test:coverage`); a plain `pnpm test` never collects it.
      coverage: {
        provider: 'v8',
        // Listing the sources makes files that no test imports show up at 0% instead of vanishing.
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.{test,spec}.{ts,tsx}',
          'src/test/**',
          'src/**/*.stories.{ts,tsx}',
          'src/**/*.d.ts',
          // Browser entry point: mounts React into the page.
          'src/main.tsx',
        ],
        reporter: ['text-summary', 'lcovonly', 'html', 'json-summary'],
        reportsDirectory: './coverage',
      },
    },
  }),
);
