# Convenciones — EnVault Management

> 🇬🇧 English version: [../en/conventions.md](../en/conventions.md)

## Nombrado de archivos

- Módulos del API: nombres planos dentro de su carpeta de dominio — `service.ts`, `controller.ts`, `module.ts`. El contexto lo da la carpeta (ej: `modules/backup/service.ts`).
- Componentes React: PascalCase — `StatusBadge.tsx`, `Layout.tsx`.
- Hooks: camelCase con prefijo `use` — `useConnections.ts`, `useBackupHistory.ts`.
- Enums del backend: `kebab-case.enum.ts` en `apps/api/src/database/enums/` (ej: `backup-category.enum.ts`). Son la fuente de verdad de los valores cross-app.
- Tipos del frontend que duplican enums del backend: `kebab-case.types.ts` en `apps/web/src/types/` o en `features/<feature>/types.ts`.

---

## Imports

- Nunca importar entre apps directamente (`apps/web` no importa de `apps/api`).
- No hay paquete compartido. Los contratos cross-app (enums / string unions usados en DTOs, query params, payloads) se **duplican**:
  - **Backend** es la source of truth: enums TypeScript en `apps/api/src/database/enums/`, validados en runtime con `@IsEnum` de class-validator.
  - **Frontend** replica los valores literales como union types en `apps/web/src/types/` o `features/<feature>/types.ts`.
- Si agregás un valor nuevo a un enum del backend, replicalo en el union type del frontend en el mismo PR. La validación con `@IsEnum` cortará cualquier request del frontend que mande un valor que se olvidó de sincronizar.

---

## Variables de entorno

- Nunca commitear `.env` con valores reales — están en `.gitignore`.
- Los `.env.example` son la fuente de verdad de qué variables existen.
- Variables del frontend deben comenzar con `VITE_` para que Vite las inyecte en el bundle.
- En Railway: configurar como Service Variables. Las `VITE_*` se pasan automáticamente como build args si el Dockerfile las declara como `ARG`.

---

## Commits — Conventional Commits

### Tipos que disparan release

| Tipo | Bump | Cuándo usarlo |
|------|------|---------------|
| `fix:` | patch (0.1.0 → 0.1.1) | Corrección de bug |
| `perf:` | patch (0.1.0 → 0.1.1) | Mejora de rendimiento sin cambio de API |
| `feat:` | minor (0.1.0 → 0.2.0) | Funcionalidad nueva visible para el usuario |
| `feat!:` | major (0.1.0 → 1.0.0) | Breaking change |

**El test para `feat:`**: ¿puede el usuario hacer algo que ANTES NO PODÍA? Sí → `feat:`. No (wirear, extraer, migrar, polish) → `refactor:` (sin release).

### Tipos que NO disparan release (uso libre)

`chore:`, `docs:`, `refactor:`, `build:`, `ci:`, `style:`, `test:` — útiles para historial limpio, pero no generan version bump.

### Regla estricta: SIN paréntesis ni scopes

```
✅ fix: handle connection timeout gracefully
✅ feat: add on-demand backup endpoint
✅ feat!: change R2 path structure
✅ chore: upgrade NestJS to 11.0.7
✅ refactor: simplify auth guard session validation

❌ fix(connections): handle connection timeout gracefully
❌ feat(backup): add on-demand backup endpoint
❌ chore(deps): upgrade NestJS
```

**Por qué sin scopes**: el subject ya describe el qué; el path del diff describe el dónde. Los paréntesis agregan ruido visual sin información que el reviewer no pueda ver mejor en `git show`.

### Breaking changes

Dos formas válidas:

1. **Bang**: `feat!: drop support for Node 20`
2. **Trailer en el body**:
   ```
   feat: redesign auth flow

   BREAKING CHANGE: tokens now expire after 1h instead of 24h.
   Clients must implement refresh logic.
   ```

Para releases mayores siempre incluir el trailer con explicación, incluso si ya usaste `!`. El changelog generado por semantic-release lee el trailer.

---

## TypeScript

Config en dos niveles:

**`tsconfig.base.json` (raíz)** — opciones compartidas:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

**Cada app extiende la base:**

- `apps/api` — agrega `"module": "CommonJS"`, `emitDecoratorMetadata: true`, `experimentalDecorators: true` (requeridos por NestJS).
- `apps/web` — agrega `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"` (Vite bundler mode).

---

## pnpm workspaces

**`.npmrc`:**

```ini
shamefully-hoist=false        # Aislamiento estricto: evita phantom dependencies
strict-peer-dependencies=false
auto-install-peers=true
link-workspace-packages=true  # Resuelve workspace:* via symlinks locales
```
