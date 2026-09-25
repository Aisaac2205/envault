# Modelo de Seguridad

> 🇬🇧 English version: [../en/security-model.md](../en/security-model.md)

Este documento captura los **invariantes de seguridad** del sistema. No son sugerencias — son reglas que el código aplica activamente. Romperlos requiere modificar código y dejará rastro en review.

---

## 1. Invariantes de PROD

### 1.1 Las conexiones PROD son inmutables desde la API

**Dónde:** `apps/api/src/modules/connections/connections.service.ts`

```typescript
if (existing.environment === Environment.PROD) {
  throw new ForbiddenException(...);
}
```

Aplica a `update()` y `delete()`. La razón: una conexión PROD es la fuente de verdad. Modificarla desde la app abre la puerta a que un usuario con permisos pueda apuntar el job de backup hacia un host falso y exfiltrar dumps.

### 1.2 Los backups solo pueden originarse en PROD

**Dónde:** `apps/api/src/modules/backup/backup.service.ts`

```typescript
if (connection.environment !== Environment.PROD) {
  throw new BadRequestException(...);
}
```

Por diseño: este sistema existe para mover datos **desde** PROD **hacia** entornos de prueba. Backupear DEV/SQA no tiene sentido y se bloquea explícitamente.

### 1.3 Los restores nunca pueden tocar PROD

**Dónde:** `apps/api/src/modules/restore/restore.service.ts`

```typescript
if (targetEnvironment === Environment.PROD) {
  throw new ForbiddenException(...);
}
```

Esta es **la regla más crítica**. Restaurar sobre PROD destruiría datos en vivo.

> **Nota histórica:** Existió un `NoProdRestoreGuard` a nivel controller. Se eliminó porque inspeccionaba `body.targetEnvironment`, pero el DTO tiene `targetConnectionId` (UUID). El guard nunca encontraba el campo y siempre dejaba pasar — protección falsa. La protección real vive y siempre vivió en el service, donde se resuelve la conexión y se lee su environment de DB. Ver `docs/scheduler-architecture.md` para el patrón equivalente.

---

## 2. Autenticación

### Stack

- **Librería**: Better Auth (email/password + plugin admin) — corre dentro del proceso NestJS. Sin IdP externo.
- **Integración**: handler catch-all manual en `/api/auth/*` en `apps/api/src/auth/auth.controller.ts`
- **Sesión**: basada en cookies (`httpOnly`), gestionada completamente por Better Auth vía un adaptador pg
- **Validación de sesión**: `auth.api.getSession()` llamado por request por `BetterAuthGuard`. Las sesiones se cachean con TTL de 5 minutos para reducir round-trips a la DB.
- **Tablas de DB**: Better Auth gestiona su propio schema (`user`, `session`, `account`, `verification`) vía el adaptador pg.
- **Frontend**: cliente `better-auth/react` con hook `useSession()`; las cookies las envía el browser automáticamente.
- **SSE**: las cookies las manda `EventSource` nativamente — no se necesita el hack de token por query param.
- **Seed de admin**: al primer boot, se crea un usuario admin por defecto desde `BETTER_AUTH_ADMIN_EMAIL` / `BETTER_AUTH_ADMIN_PASSWORD`.

### Datos de sesión usados por la API

| Campo | Uso |
|-------|-----|
| `session.user.id` | ID del usuario, va a `audit_logs.userId` y `backup_jobs.triggeredBy` |
| `session.user.name` | Identificador legible, usado en logs |
| `session.user.email` | Usado en `audit_logs.userEmail` |
| `session.user.role` | Control de roles (`admin` vs usuario regular) |

### Guard

`BetterAuthGuard` (en `apps/api/src/auth/auth.guard.ts`) se aplica **explícitamente** en cada controller. No hay guard global. Si agregás un controller nuevo, **acordate de proteger sus endpoints**.

Excepción consciente: `/health` no requiere auth (lo consume el K8s probe).

---

## 3. Auditoría

### ¿Qué se audita?

Dos fuentes independientes escriben en la misma tabla append-only `audit_logs`:

1. **Mutaciones de recursos** — cualquier request HTTP con método `POST`, `PUT`, `PATCH` o `DELETE` que pase por el `AuditInterceptor` global. **Se auditan tanto los éxitos como los errores** (`tap({ next, error })`). Un intento fallido de borrar PROD también queda registrado.

2. **Eventos de autenticación** — login, logout y cambio de contraseña, capturados por el middleware `hooks.after` de Better Auth (`apps/api/src/auth/audit/`). El `AuditInterceptor` no los ve porque `auth.controller.ts` usa `@Res()` y descarta el handler con `void`, dejando al pipeline de Nest sin observar el resultado.

Los endpoints de autenticación auditados son un **allowlist** (`AUDITED_PATHS`), no un denylist. `hooks.after` dispara en todos los endpoints incluido `/get-session`, que la SPA consulta constantemente; los endpoints no listados se descartan para no saturar la tabla.

El hook escribe a través del pool de `pg` (`authPool`) que Better Auth ya posee. Toda escritura va en `try/catch`: un fallo de auditoría **nunca debe interrumpir el login de un usuario**.

### Estructura de un registro

```typescript
{
  id: uuid,
  action: "DELETE /connections/abc-123" | "auth.sign-in.email",
  userId: "user-id" | "anonymous",
  username: "user@example.com" | "anonymous",
  resourceType: "ConnectionsController" | "Auth",
  resourceId: "abc-123" | "sign-in/email",
  metadata: { ...redacted body... },
  environment: "prod" | "dev" | "qa" | null,
  ipAddress: "203.0.113.7" | null,
  userAgent: string | null,
  outcome: "success" | "failure",
  severity: "low" | "medium" | "high" | "critical",
  createdAt: timestamp
}
```

`ipAddress`, `userAgent`, `outcome` y `severity` se agregaron siguiendo el OWASP Logging Cheat Sheet. La IP se lee de `x-real-ip` (nginx sobrescribe con un valor validado, ignorando la cadena multi-hop spoofable de `X-Forwarded-For`).

`environment` es `null` para eventos de autenticación: el enum describe el entorno de una conexión ERP auditada, y un inicio de sesión no pertenece a ninguno.

### Limitaciones conocidas

1. **Los cronjobs no se auditan en `audit_logs`.** Corren in-process, no por HTTP, así que el interceptor no los ve. Su trazabilidad vive en `backup_jobs.triggeredBy = 'system-cronjob'`.

2. **Los logs son append-only a nivel DB.** Un trigger (`audit_logs_immutable`) lanza una excepción ante cualquier `UPDATE` o `DELETE` en la tabla `audit_logs`. Esto previene adulteración incluso por usuarios con acceso directo a la DB. Para non-repudiation criptográfico, los registros deberían además firmarse o exportarse a un sistema WORM.

---

## 4. Credenciales de conexión

Las contraseñas de las DBs registradas se **cifran en reposo** usando AES-256-GCM en la columna `connections.password`.

### Cómo funciona

- Un column transformer de TypeORM (`apps/api/src/common/utils/encryption.ts`) cifra al escribir y descifra al leer usando la variable de entorno `ENCRYPTION_KEY`.
- El formato almacenado es `iv:authTag:ciphertext` (todo en hex). Cada escritura usa un IV aleatorio, así que el mismo password produce un ciphertext diferente cada vez.
- El decorador `@Exclude()` de `class-transformer` asegura que el password descifrado **nunca sale por la API** en responses HTTP.
- Las queries de listado/detalle del repository usan un `select` explícito que excluye la columna password. Solo `findById` (usado internamente por backup/restore) la retorna.
- Valores legacy en plaintext (de antes del cifrado) se detectan en la función `decrypt` (no tienen el formato `iv:tag:ciphertext`) y se retornan tal cual, permitiendo migración transparente.

### Requisitos

- `ENCRYPTION_KEY` debe setearse como un string hex de 64 caracteres (clave de 256 bits). Generar con:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Si se pierde la clave, **todos los passwords almacenados quedan irrecuperables**. Respaldar la clave de forma segura.
- No hay rotación automática de credenciales todavía.

---

## 5. CORS

```typescript
// apps/api/src/config/env.validation.ts
CORS_ORIGIN: Joi.string().required(),
```

Si `CORS_ORIGIN` no está definido, **la app no arranca**. Sin defaults silenciosos ni wildcards.
Configurar con el origen exacto del frontend (ej: `http://localhost:5173` o `https://app.example.com`).

---

## 6. Validación de input

Un único `ValidationPipe` global, registrado una sola vez como `APP_PIPE` en `app.module.ts` y configurado en `apps/api/src/common/pipes/validation-pipe.options.ts`:

```typescript
{
  whitelist: true,            // ignora props no declaradas en el DTO
  forbidNonWhitelisted: true, // rechaza requests con props extra (400)
  transform: true,            // convierte a la clase del DTO
  transformOptions: { enableImplicitConversion: true }, // coacciona tipos primitivos
}
```

El rechazo aplica tanto al body como al query string, así que un parámetro de query no declarado devuelve 400 en vez de ignorarse en silencio.

Combinado con `class-validator` en cada DTO (`@IsString`, `@IsUUID`, `@IsEnum`, etc.). Esto cubre la **mayoría** de los OWASP Top 10 input-related. Lo que NO cubre:

- **SQLi**: TypeORM con queries parametrizadas lo previene. El único raw SQL del proyecto está en `restore.service.ts` (`dryRun*`) y son queries fijas sin interpolación de input.
- **SSRF en `host`/`port` de conexiones**: no se valida que no apunten a `localhost`/`169.254.169.254`/etc. Si el sistema corre en cloud, considerar un allowlist de subnets.

---

## 7. Resumen del threat model

| Amenaza | Mitigación |
|---------|------------|
| Usuario con sesión válida borra una DB de PROD por error | Bloqueado: `update`/`delete` lanzan 403 si environment=PROD |
| Usuario maliciosamente restaura un dump viejo sobre PROD | Bloqueado: `restore` lanza 403 si target environment=PROD |
| Dump exfiltrado vía URL de R2 | Mitigado: bucket privado, acceso vía credenciales R2 (no público) |
| Cookie de sesión robada vía XSS | Mitigado: el flag `httpOnly` impide el acceso de JavaScript a la cookie; CORS strict en prod limita origen |
| DB de control comprometida → leak de credenciales de PROD | Mitigado: passwords cifrados con AES-256-GCM. Requiere `ENCRYPTION_KEY` para descifrar. Ver §4 |
| Audit log adulterado por DBA con acceso | Mitigado: trigger append-only previene UPDATE/DELETE en `audit_logs`. Ver §3 |
| Cronjob apunta a host atacante | Mitigado: cronjob requiere `connectionId` que solo puede crearse via `POST /connections` (auditado) |
| Cuenta de admin comprometida | Rotar `BETTER_AUTH_SECRET` para invalidar todas las sesiones; resetear password del admin vía la API admin de Better Auth |

Las amenazas no mitigadas restantes (SSRF en hosts de conexiones, falta de rotación de credenciales) son **decisiones conscientes** para el alcance actual del sistema (tool interno, equipo pequeño, cloud privado).
