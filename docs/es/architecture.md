# Arquitectura — EnVault Management

> 🇬🇧 English version: [../en/architecture.md](../en/architecture.md)

## API — NestJS Monolito Modular

**Ruta:** `apps/api` | **Puerto:** `3000`

La API sigue el patrón de **Monolito Modular**: un único proceso NestJS dividido en módulos de dominio bien delimitados. Cada módulo es autónomo (controlador, servicio, DTOs y entidades propios) y se importa en `AppModule`. Esta arquitectura facilita escalar hacia microservicios sin cambiar las interfaces internas.

### Módulos de dominio (`src/modules/`)

| Módulo | Ruta | Responsabilidad |
|--------|------|-----------------|
| `connections` | `src/modules/connections/` | CRUD de conexiones a bases de datos (host, puerto, credenciales, tipo) |
| `backup` | `src/modules/backup/` | Ejecución de dumps bajo demanda y almacenamiento en R2 |
| `restore` | `src/modules/restore/` | Descarga de un dump desde R2 y restauración en la base de datos destino |
| `jobs` | `src/modules/jobs/` | Gestión y ejecución de jobs de backup |
| `cronjobs` | `src/modules/cronjobs/` | Schedules automáticos de backup (cron) |
| `audit` | `src/modules/audit/` | Registro inmutable de todas las operaciones ejecutadas |

### Infraestructura transversal

```
apps/api/src/
│
├── auth/                        # Autenticación (Better Auth, sesiones por cookie)
│   ├── auth.config.ts           # Instancia de Better Auth
│   ├── auth.controller.ts       # Handler catch-all /api/auth/*
│   ├── auth.guard.ts            # BetterAuthGuard
│   ├── decorators/              # @CurrentUser, etc.
│   └── seeds/                   # Seed del admin por defecto al primer boot
│
├── common/
│   ├── guards/                  # Guards de autenticación
│   ├── interceptors/            # Logging, transformación de respuesta
│   ├── filters/                 # Exception filters centralizados
│   └── decorators/              # @CurrentUser, @Roles, etc.
│
├── config/
│   ├── database.config.ts       # TypeORM + PostgreSQL
│   ├── r2.config.ts             # Cliente S3 para Cloudflare R2
│   └── env.validation.ts        # Validación de env con Joi
│
├── connections/                 # Seed script para conexiones iniciales
│
├── database/
│   ├── entities/                # Entidades TypeORM
│   ├── enums/                   # Enumeraciones de dominio
│   └── migrations/              # Migraciones TypeORM
│
├── health/
│   ├── health.controller.ts     # GET /health — liveness/readiness
│   └── health.module.ts
│
├── modules/                     # Módulos de dominio (ver tabla arriba)
│   ├── backup/
│   ├── restore/
│   ├── connections/
│   ├── jobs/
│   ├── cronjobs/
│   └── audit/
│
├── shared/
│   └── sse/                     # Server-Sent Events gateway
│
├── app.module.ts
└── main.ts
```

---

## Web — React + Vite Vertical Slice

**Ruta:** `apps/web` | **Puerto dev:** `5173` | **Puerto producción:** `80` (nginx)

El frontend sigue la arquitectura **Vertical Slice**: cada pantalla (feature) es una unidad autocontenida. No hay una carpeta `components/` global — solo existe `shared/` para los elementos verdaderamente reutilizables.

### Features (`src/features/`)

| Feature | Ruta | Descripción |
|---------|------|-------------|
| `dashboard` | `src/features/dashboard/` | Vista general: última ejecución de cada job, espacio en R2, conexiones activas |
| `dumps` | `src/features/dumps/` | Listado, descarga y ejecución manual de backups |
| `restore` | `src/features/restore/` | Selección de dump y restauración en una conexión destino |
| `cronjobs` | `src/features/cronjobs/` | Alta, baja y modificación de schedules de backup automático |
| `connections` | `src/features/connections/` | Gestión de conexiones (test de conectividad incluido) |
| `audit` | `src/features/audit/` | Log de auditoría con filtros por fecha, usuario y tipo de operación |

Cada feature tiene esta estructura interna:

```
feature/
├── index.tsx          # Componente página (lazy-loadable, export default)
├── types.ts           # Tipos locales de la feature (no compartidos)
├── components/        # Componentes exclusivos de esta pantalla
└── hooks/             # Hooks de datos y lógica local
```

### Shared (`src/shared/`)

Elementos verdaderamente reutilizables entre features:

```
src/shared/
├── assets/         # Imágenes, íconos y recursos estáticos
├── components/     # Componentes UI reutilizables (Layout, Sidebar, etc.)
├── hooks/          # Hooks genéricos (useDebounce, usePagination, useSSE…)
├── lib/            # Utilidades puras, cliente HTTP (axios), helpers
├── providers/      # Context providers (auth, theme, etc.)
├── styles/         # Estilos globales, tokens de diseño, reset CSS
└── ui/             # Primitivos de UI base (botones, inputs, badges…)
```

---

## Tiempo real — SSE (Server-Sent Events)

La API emite eventos desde `src/shared/sse/` que el frontend consume con el hook `useSSE` (en `shared/hooks/`). Esto permite actualizar en vivo el estado de backups, restores y jobs sin polling.

El hook maneja:
- Conexión inicial y reconexión automática ante desconexiones
- Dispatch de eventos tipados a las features correspondientes
- Cleanup en desmontaje del componente
