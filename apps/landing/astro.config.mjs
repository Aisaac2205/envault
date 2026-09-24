import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

const { PUBLIC_SITE_URL } = loadEnv(
  process.env.NODE_ENV ?? 'development',
  process.cwd(),
  'PUBLIC_',
);

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  site: PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'http://localhost:4321',
  output: 'static',
  integrations: [react()],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
