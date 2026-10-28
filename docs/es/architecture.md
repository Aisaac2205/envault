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
│   ├── authorization/           # Mapa de permisos, PermissionsGuard, @RequirePermission, GET /api/me/permissions
│   ├── guards/                  # Guards de autenticación
│   ├── interceptors/            # Logging, transformación de respuesta
│   ├── filters/                 # Exception filters centralizados
│   └── decorators/              # Decorators de request
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

### Control de acceso

La web no mantiene ninguna lista de quién puede ver qué. Las secciones de la barra lateral (`shared/lib/sections.ts`), los guards de ruta (`ProtectedRoute feature="..."`) y la pantalla sin acceso (`features/auth/NoAccessPage.tsx`, ruta `/no-access`) dependen de `usePermissions` (`shared/hooks/`), que lee `GET /api/me/permissions`. El API es dueño del mapa de permisos y lo aplica; ver [security-model.md](security-model.md#autorización-el-mapa-de-permisos).

---

## Tiempo Real con Server-Sent Events (SSE)

La API emite eventos desde `src/shared/sse/` que el frontend consume con el hook `useSSE` (en `shared/hooks/`). Esto permite actualizar en vivo el estado de backups, restores y jobs sin polling.

Cada job tiene su propio stream, `GET /api/backups/:id/stream` y `GET /api/restores/:id/stream`, respaldado por Redis y no por la memoria del proceso:

- **Entre réplicas**: el worker que ejecuta un job agrega cada evento a una lista acotada `sse:job:<id>:events` (los últimos 500), lo numera con el contador `sse:job:<id>:seq` y lo publica en el canal `sse:job:<id>`. Cada proceso de la API mantiene una única suscripción por patrón compartida, así que un navegador conectado a cualquier réplica recibe los eventos de un job que corre en otra.
- **Reproducción**: un suscriptor que se conecta tarde, o que se reconecta, recibe primero el historial guardado y luego los eventos en vivo, sin duplicados gracias al número de secuencia. Tras una reconexión a Redis el historial se vuelve a leer, de modo que no se pierde nada publicado en el intervalo.
- **Retención**: el historial de un job en curso expira tras 6 horas sin eventos; cuando el job termina, sigue disponible para reproducirse durante 60 segundos.
- **Eventos terminales**: `completed` o `failed` cierran el stream. Un intento de backup fallido que BullMQ va a reintentar solo envía un evento `log` (`Intento N de M falló: … Reintentando...`); `failed` se envía tras el último intento, de modo que la UI nunca informa un fallo que el reintento convierte en éxito.
- **Formato en el cable**: el interceptor global de respuestas envuelve cada mensaje, así que cada frame llega como `{"data":{"type":…,"payload":…}}`; el cliente web acepta tanto el evento envuelto como el evento sin envolver.
- **Proxy**: el nginx del web sirve `/api/(restores|backups)/:id/stream` desde una location dedicada con el buffering desactivado y un timeout de lectura largo; sin ella, los eventos se acumularían hasta que termine la respuesta.

En la página Dumps, iniciar un backup muestra un aviso de "en cola"; luego la página sigue el stream del job, muestra el aviso de finalización (o de fallo) y actualiza el historial cuando el stream informa el final, sin recargar.

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

El resumen diario se hace primero, en la misma sentencia. Cada eliminación de filas de `backup_jobs` (retención, conciliación y limpieza de jobs fallidos) es una única sentencia SQL que borra las filas y suma a `backup_daily_rollups`, por conexión y día UTC, los conteos de COMPLETED y FAILED, el tamaño de los completados y la duración de cada uno. Como el borrado y el resumen se confirman juntos, y `DELETE ... RETURNING` entrega cada fila a una sola sentencia, una fila se resume exactamente una vez incluso si dos purgas corren al mismo tiempo. Las filas PENDING y RUNNING se borran sin contarse. `/jobs/analytics/daily` combina las filas vivas con el resumen, de modo que su historial, sus conteos y sus percentiles sobreviven a una purga; el almacenamiento por conexión sigue usando solo filas vivas porque refleja lo que aún está almacenado. El historial purgado antes de que existiera el resumen no se puede recuperar.

### 5. Simulación Previa sin Impacto Destructivo
Para validar el alcance de las políticas de retención antes de aplicar cambios irreversibles, EnVault permite ejecutar limpiezas en modo de simulación. Esta operación computa las reglas configuradas y reporta la relación exacta de copias candidatas a eliminación, sus identificadores y el volumen total de almacenamiento en bytes que se liberará, sin suprimir ningún dato del almacenamiento de objetos.

### 6. Capacidad de Almacenamiento y Límites de Cloudflare R2
La integración con Cloudflare R2 ofrece una capa gratuita permanente de diez gigabytes mensuales sin costo alguno y sin cargos por transferencia saliente hacia internet. Además, incluye un millón de operaciones de escritura Clase A y diez millones de operaciones de lectura Clase B cada mes.

El tamaño máximo admitido para un archivo individual en Cloudflare R2 alcanza los cinco terabytes. La estrategia de streaming multipart de EnVault divide los datos en partes de 32 MB, lo que permite respaldar bases de datos de hasta 320 GB en una única transmisión continua sin superar el límite de diez mil partes del protocolo S3.

Para las restauraciones que requieren espacio de trabajo en disco local, el servicio de staging comprueba previamente que el almacenamiento disponga de un margen de seguridad del veinte por ciento sobre el tamaño de la copia más un piso mínimo de 50 MB, previniendo fallos por agotamiento de espacio en disco (ENOSPC).


