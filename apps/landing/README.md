# EnVault Landing and Documentation

The landing application is the public-facing marketing website and interactive technical documentation portal for **EnVault Management**. Built with Astro 7, React 19 islands, and Tailwind CSS v4, it provides product walkthroughs, live architectural blueprints, and deployment guides.

## Features

- **Ink Garden Canvas2D Hero**: Custom interactive ASCII and luminance dither raster engine using Canvas2D with ambient particle simulation.
- **Bilingual Content Routing**: Spanish serves as the primary locale at `/`, while English pages are routed under `/en/`. Dictionaries and navigation labels are managed in `src/features/i18n/`.
- **Zero-Trust Architecture Showcase**: Topological blueprint and structural telemetry demonstrating NestJS 11 control plane, PostgreSQL distributed advisory locks, isolated worker execution, and streaming directly to Cloudflare R2 / AWS S3.
- **Platform Capabilities Bento Grid**: Highlighting concurrent-safe scheduling, live SSE restore streaming, and encryption at rest.
- **Interactive Documentation Engine**: Available at `/docs` and `/en/docs`, featuring:
  - Step-by-step guides for Docker deployment, control plane setup, and storage configuration.
  - Syntax-highlighted cURL, Python, and Node.js API snippets with instant clipboard copying.
  - Complete operations reference for PostgreSQL advisory locks and retention policies.
- **Compliance and Legal Pages**: Dedicated layouts for terms of service (`/terms`), privacy policy (`/privacy`), and security posture (`/security`).

## Project Structure

```text
apps/landing/
├── src/
│   ├── assets/              # Dashboard blueprints and preview imagery
│   ├── components/ui/       # ASCII garden canvas engine and core UI primitives
│   ├── features/
│   │   ├── architecture/    # Topological architecture blueprint section
│   │   ├── documentation/   # Docs reader, syntax highlighting, and content dictionaries
│   │   ├── features-grid/   # Bento grid highlighting platform capabilities
│   │   ├── i18n/            # Translation dictionaries for marketing copy
│   │   └── navigation/      # Site header, footer, and call-to-action banners
│   ├── layouts/             # Base HTML template, SEO tags, and font definitions
│   ├── lib/                 # Shared client utilities and API endpoint resolvers
│   ├── pages/               # Astro file-based routes (root, /en/, and /docs variants)
│   └── styles/              # Global Tailwind CSS properties and design tokens
└── public/                  # Favicons, logos, tech icons, and static assets
```

## Available Scripts

Scripts can be executed within this directory or from the monorepo root using `pnpm --filter @vaultly-control/landing <command>`.

### Development

Start the local Astro development server on port 4321:

```bash
pnpm run dev
```

### Production Build

Compile the static site and client-side JavaScript bundles to `dist/`:

```bash
pnpm run build
```

### Preview

Preview the production build locally before deployment:

```bash
pnpm run preview
```

### Type Checking

Verify Astro components and TypeScript types:

```bash
pnpm run type-check
```

### Testing

Run unit and integration tests using Vitest:

```bash
pnpm run test:run
```
