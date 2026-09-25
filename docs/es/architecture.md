# Arquitectura — EnVault Management

> 🇬🇧 English version: [../en/architecture.md](../en/architecture.md)

## API — NestJS Monolito Modular

**Ruta:** `apps/api` | **Puerto:** `3000`

La API sigue el patrón de **Monolito Modular**: un único proceso NestJS dividido en módulos de dominio bien delimitados. Cada módulo es autónomo (controlador, servicio, DTOs y entidades propios) y se importa en `AppModule`. Esta arquitectura facilita escalar hacia microservicios sin cambiar las interfaces internas.

### Módulos de dominio (`src/modules/`)

| Módulo | Ruta | Responsabilidad |
|--------|------|-----------------|
| `connections` | `src/modules/connections/` | CRUD de conexiones a bases de datos (host, puerto, credenciales, tipo) |
| `backup` | `src/modules/backup/` | Ejecución de copias bajo demanda y streaming hacia R2 |
| `restore` | `src/modules/restore/` | Descarga de una copia desde R2 y restauración en la base de datos destino |
| `queue` | `src/modules/queue/` | Configuración del cliente Redis y BullMQ para procesamiento asíncrono |
| `jobs` | `src/modules/jobs/` | Gestión y ciclo de vida de trabajos de respaldo |
| `cronjobs` | `src/modules/cronjobs/` | Programaciones automáticas de respaldo (cron) |
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

## Tiempo Real con Server-Sent Events (SSE)

La API emite eventos desde `src/shared/sse/` que el frontend consume con el hook `useSSE` (en `shared/hooks/`). Esto permite actualizar en vivo el estado de backups, restores y jobs sin polling.

El hook maneja:
- Conexión inicial y reconexión automática ante desconexiones
- Dispatch de eventos tipados a las features correspondientes
- Cleanup en desmontaje del componente

---

## Colas y Procesamiento Asíncrono (Redis + BullMQ)

EnVault procesa tareas de alta carga computacional y transferencia de red mediante BullMQ y Redis 7, desacoplando la ejecución del ciclo de petición HTTP.

### 1. Desacople y Ciclo de Vida de Trabajos
La creación de copias de seguridad y las solicitudes de restauración responden de manera inmediata con código HTTP 202 Accepted. La API genera el registro del trabajo en estado PENDING, deposita la carga útil en Redis y delega la ejecución en workers especializados. El cliente supervisa el progreso en tiempo real mediante el canal de Server-Sent Events.

### 2. Aislamiento y Concurrencia por Conexión
Cada trabajo verifica si existe otra tarea en estado PENDING o RUNNING para la misma base de datos. Ante colisiones, el sistema rechaza la solicitud con código HTTP 409 Conflict para evitar contención de bloqueos o saturación de recursos en motores administrados.

### 3. Canalización Multipart Directa hacia R2
El flujo de salida del motor de base de datos se transmite directamente hacia Cloudflare R2 sin tocar el disco local del contenedor. El procesador fragmenta el flujo en partes de 32 MB y gestiona una cola concurrente de cuatro transferencias en paralelo. En caso de error o anulación, el sistema ejecuta una orden de aborto que elimina las partes incompletas en el almacenamiento de objetos.

### 4. Depuración Coordinada en Dos Etapas
El proceso de purga opera en dos etapas coordinadas para garantizar que no permanezcan archivos huérfanos en la nube ni registros inconsistentes en la base de control. En primer lugar, se emite la orden de eliminación física hacia el bucket de almacenamiento de objetos, y una vez confirmada la supresión del archivo remoto, se purga el registro correspondiente en la base de datos de control.

### 5. Simulación Previa sin Impacto Destructivo
Para validar el alcance de las políticas de retención antes de aplicar cambios irreversibles, EnVault permite ejecutar limpiezas en modo de simulación. Esta operación computa las reglas configuradas y reporta la relación exacta de copias candidatas a eliminación, sus identificadores y el volumen total de almacenamiento en bytes que se liberará, sin suprimir ningún dato del almacenamiento de objetos.

