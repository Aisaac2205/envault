# Qably Landing and Documentation

The landing application is the public-facing marketing website and interactive technical documentation portal for Qably. Built with Astro 7, React 19 islands, and Tailwind CSS v4, it provides product walkthroughs, live visual component previews, and API integration guides.

## Features

- **Bilingual Content Routing:** Spanish serves as the primary locale at `/`, while English pages are routed under `/en/`. Dictionaries and navigation labels are managed in `src/features/i18n/`.
- **Interactive Component Previews:** React 19 islands embed product interfaces directly into marketing sections:
  - `DashboardWindowFrame`: Desktop window replica illustrating pass rates, active test runs, and test suites.
  - `RealTraceabilityCalendar`: Contribution heatmap displaying daily execution density and test run outcomes.
  - `MobileDashboardIphone`: Vector iPhone 16 Pro mockup rendering responsive QA telemetry.
  - `PricingSection`: Dynamic pricing tier comparison.
- **Interactive Documentation Engine:** Available at `/docs` and `/en/docs`, featuring:
  - Topic navigation across setup steps, CI integration, SCM webhooks, and API references.
  - Code blocks with syntax highlighting and instant clipboard copying.
  - Multi-tab code snippets displaying reporting commands across languages and test frameworks.
- **Compliance and Legal Pages:** Dedicated layouts for terms of service, privacy policies, and security posture.

## Project Structure

```text
apps/landing/
├── src/
│   ├── components/ui/        # Reusable visual shells and vector device mockups
│   ├── features/
│   │   ├── dashboard-preview/ # Dashboard window frame and calendar preview
│   │   ├── documentation/     # Docs reader, syntax highlighting, and content dictionaries
│   │   ├── features-grid/     # Grid highlighting platform capabilities
│   │   ├── i18n/              # Translation dictionaries for marketing copy
│   │   ├── integrations/      # SCM and CI/CD provider marquee animations
│   │   ├── mobile-dashboard/  # Mobile preview components
│   │   ├── navigation/        # Header, footer, and call-to-action banners
│   │   └── pricing/           # Tier comparison and plan selection cards
│   ├── layouts/               # Base HTML templates and font definitions
│   ├── pages/                 # Astro file-based routes (root and /en/ variants)
│   └── styles/                # Global Tailwind CSS custom properties
└── public/                    # Static assets, logos, and OpenGraph images
```

## Available Scripts

Scripts can be executed within this directory or from the monorepo root using `pnpm --filter @qably/landing <command>`.

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
