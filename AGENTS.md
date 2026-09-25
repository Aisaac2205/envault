# EnVault Management — Agent Guide

## Monorepo Structure

```
vaultly-dumps/
└── apps/
    ├── api/          # NestJS 11 backend (TypeORM + PostgreSQL)
    └── web/          # React 19 frontend (Vite + React Router 7)
```

**Package manager:** pnpm workspaces (`pnpm-workspace.yaml`, includes `apps/*` only)
**Node:** >=22 | **pnpm:** >=9

### Workspace Dependencies

| Package                | Key Dependencies                                               |
| ---------------------- | -------------------------------------------------------------- |
| `@vaultly-control/api` | NestJS 11, TypeORM, PostgreSQL, Better Auth, Swagger, Joi      |
| `@vaultly-control/web` | React 19, React Router 7, Vite, TanStack Query, radix-ui, cmdk |

There is no shared package. Cross-app contracts (enums / string unions for DTOs, query params, etc.) are duplicated: the **backend is the source of truth**, the frontend mirrors the literal values. Drift is caught by `@IsEnum` validators on the backend, not by a shared type.

### Scripts (root)

```bash
pnpm dev          # Run all apps in parallel
pnpm build        # Build all apps in parallel
pnpm lint         # Lint all packages
pnpm test         # Test all packages
pnpm typecheck    # Type-check all packages
```

Per-package scripts: `pnpm --filter @vaultly-control/api dev`, etc.

---

## Available Skills

Located in `.agents/skills/` and `.claude/skills/`. Auto-load based on context.

| Skill                         | Trigger                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **nestjs-best-practices**     | Writing, reviewing, or refactoring NestJS code. Covers architecture, DI, security, testing, database, API design, microservices, DevOps. 40 rules prioritized CRITICAL → LOW.       |
| **react-dev**                 | Building React components with TypeScript. Covers React 19 patterns (ref as prop, useActionState, use()), generic components, event typing, hooks, routing (TanStack/React Router). |
| **typescript-react-reviewer** | Reviewing React/TypeScript code. Detects useEffect abuse, state mutation, missing cleanup, `any` types, React 19 hook mistakes. Priority: Critical → High → Style.                  |
| **find-skills**               | User asks "how do I do X", "find a skill for", or wants to extend agent capabilities. Uses `npx skills` CLI to search/install from ecosystem.                                       |

### UI/UX Design Skills — **MANDATORY** for any UI/UX work

Loading these skills is **not optional**. Any work that touches components, pages, layouts, navigation, design tokens, color, typography, motion, or accessibility in `apps/web/src/` MUST load and apply all three before writing code:

| Skill                      | Scope                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **design-taste-frontend**  | Anti-slop frontend design. Brief inference, dials (variance/motion/density), section rhythm, copy self-audit, anti-default discipline. |
| **emil-design-eng**       | Animation decision framework, easing curves, button feedback, `@starting-style`, `useReducedMotion`, tooltips, gestures.      |
| **impeccable**             | Design taste + code quality for production-grade UI. Runs setup context script, then craft/audit/polish sub-commands.            |

**Why mandatory**: these three skills were used to design the entire `ui-ux-overhaul` change (14 PRs, A2 Electric Blue accent, Linear-style sidebar, shadcn-ui foundation). Skipping them on UI work is a Pre-Flight Fail and produces AI-slop output that breaks consistency with the rest of the app.

### Skill Loading Rules

1. Check file paths being touched — `.ts` in `apps/api/src/` → load `nestjs-best-practices`
2. `.tsx`/`.ts` in `apps/web/src/` → load `react-dev` (writing) or `typescript-react-reviewer` (reviewing)
3. **UI/UX work in `apps/web/src/`** → MUST also load all three design skills (design-taste-frontend, emil-design-eng, impeccable). Non-optional.
4. User asks for external skill/capability → load `find-skills`
5. Multiple skills can apply simultaneously

---

## Conventions

- **TypeScript everywhere** — strict mode, no `any` without justification
- **Feature-based organization** in NestJS (not by technical layer)
- **React 19** — no `forwardRef` (use `ref` as prop), no `useFormState` (use `useActionState`)
- **Cross-app contracts** are duplicated, not shared. Backend enums live in `apps/api/src/database/enums/` (source of truth, validated with `@IsEnum`). Frontend mirrors the literal union types in `apps/web/src/types/` or per-feature `types.ts`.
- **Never** commit secrets, `.env` files, or build artifacts
