# Modelo de Seguridad

> 🇬🇧 English version: [../en/security-model.md](../en/security-model.md)

Este documento captura los **invariantes de seguridad** del sistema. No son sugerencias — son reglas que el código aplica activamente. Romperlos requiere modificar código y dejará rastro en review.

---

## 1. Invariantes de PROD

### 1.1 Las conexiones PROD son inmutables desde la API

**Dónde:** `apps/api/src/modules/connections/connections.service.ts` (edición) y `apps/api/src/modules/connections/connection-deletion.service.ts` (eliminación)

```typescript
if (existing.environment === Environment.PROD) {
  throw new ForbiddenException(...);
}
```

| Operación | Regla |
|-----------|-------|
| Editar una conexión PROD (`PATCH`) | Siempre `403`, incluido cambiar `environment` de `prod` a otro valor |
| Reclasificar como PROD una conexión que no lo es | Siempre `403`: una conexión PROD debe crearse como PROD |
| Eliminar una conexión PROD (`DELETE`) | Solo un admin, con confirmación reforzada (ver abajo) |
| Eliminar una conexión que no es PROD | Solo un admin, sin confirmación |

La razón: una conexión PROD es la fuente de verdad. Modificarla desde la app abre la puerta a que un usuario con permisos pueda apuntar el job de backup hacia un host falso y exfiltrar dumps, o reclasificarla como QA y restaurar sobre producción.

**Eliminación con confirmación reforzada.** El body de `DELETE /connections/:id` debe incluir el nombre exacto de la conexión (`confirmName`, comparado tal cual: cuentan mayúsculas y espacios) y la contraseña actual del admin (`password`). El `verifyPassword` de Better Auth comprueba la contraseña en el servidor contra la sesión que envió la petición, por lo que el body no puede indicar otra cuenta. Si falta un campo o el nombre no coincide, la respuesta es `403` sin comprobar la contraseña; una contraseña incorrecta responde `403`. La web pide ambos datos en un diálogo de confirmación y no ofrece la acción Editar en las filas PROD. Las eliminaciones rechazadas y las aceptadas se auditan con entorno `prod` y la contraseña redactada.

**Límite de intentos fallidos.** 5 contraseñas incorrectas por admin en 15 minutos responden `429` con `Retry-After`, sin volver a comprobar la contraseña. Las contraseñas correctas no cuentan, y las comprobaciones de un mismo admin se ejecutan de una en una, así que las peticiones en paralelo no pueden ejecutar más de 5 comprobaciones. El contador vive en la memoria del proceso de la API: se reinicia al reiniciar la API, y cada instancia lleva el suyo (el despliegue soportado usa una sola réplica).

**Qué hace una eliminación.** Es un soft delete (`isActive = false`) del registro propio de EnVault: quita los metadatos y el acceso de la conexión en la app, y nunca se conecta a la base de datos de producción ni la modifica. Los dumps que ya están en R2 bajo el slug de la conexión siguen en el bucket, pero la app ya no puede restaurarlos: un restore busca el origen del dump por slug entre las conexiones activas y lo rechaza con `403`. Una conexión nueva nunca reutiliza el slug de una eliminada.

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
- **Validación de sesión**: `auth.api.getSession()` llamado por request por `BetterAuthGuard`. La caché de sesión en cookie está desactivada (`session.cookieCache.enabled: false` en `auth.config.ts`), así que cada request valida la sesión contra la base de datos: un baneo, una sesión revocada o un cambio de rol se aplican en el siguiente request.
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
| `session.user.role` | Se busca en el mapa de permisos (ver [Autorización](#autorización-el-mapa-de-permisos)) |

### Guard

`BetterAuthGuard` (en `apps/api/src/auth/auth.guard.ts`) y `PermissionsGuard` (ver Autorización más abajo) se registran **globalmente** (`APP_GUARD`, en ese orden, después del throttler). Toda ruta necesita una sesión y una función que el mapa de permisos conceda a quien llama, salvo que se excluya explícitamente; por eso un controller escrito sin ningún decorator responde 401 sin sesión y 403 con ella.

Excepciones conscientes, todas listadas en `permission-coverage.spec.ts`: `@Public()` en `/health` (lo consume el K8s probe) y en el catch-all de Better Auth `/api/auth/*` (el inicio de sesión debe funcionar sin sesión, y sus rutas de admin verifican sesión y rol dentro de Better Auth), y `@AuthenticatedOnly()` en `GET /api/me/permissions`.

### Autorización: el mapa de permisos

Quién puede usar qué se decide en **un solo lugar**: `apps/api/src/common/authorization/permissions.ts`. Todo lo demás se deriva de él: el guard de cada controller, el endpoint que lee la web y, a través de ese endpoint, la barra lateral y los guards de ruta. Antes de que existiera el mapa, el API (`@Roles('admin')` en cada controller) y la web (una lista `adminOnly` mantenida a mano) llevaban cada uno su propia copia y se fueron desalineando, de modo que a un usuario normal se le ofrecían pantallas cuyas peticiones respondían todas 403 (defecto D8).

```typescript
export const PERMISSIONS = {
  dashboard: ['admin'],
  dumps: ['admin'],
  restore: ['admin'],
  cronjobs: ['admin'],
  connections: ['admin'],
  cleanup: ['admin'],
  audit: ['admin'],
  users: ['admin'],
} as const satisfies Record<string, readonly Role[]>;
```

| Función | Respalda (API) | Sección de la web |
|---------|----------------|-------------------|
| `dashboard` | `/jobs`, `/jobs/analytics` | `/` |
| `dumps` | `/backups` | `/dumps` |
| `restore` | `/restores`, incluido su stream de progreso | `/restore` |
| `cronjobs` | `/cronjobs`, `/backups/settings` | `/cronjobs` |
| `connections` | `/connections` | `/connections` |
| `cleanup` | `/maintenance` | `/cleanup` |
| `audit` | `/audit` | `/audit`, `/audit/:id` |
| `users` | Plugin admin de Better Auth (`/api/auth/admin/*`) | `/users` |

Cómo funciona:

- **El servidor es la autoridad.** El API consulta el mapa en cada request. La web solo lo usa para decidir qué mostrar, algo de usabilidad y nunca un control de seguridad (OWASP Authorization Cheat Sheet: aplicar en el servidor, denegar por defecto, mínimo privilegio).
- **Denegar por defecto, en tiempo de ejecución.** Los guards son globales, así que nada queda abierto por accidente: una ruta que no declara nada, una función que no está en el mapa y un rol que no figura bajo una función terminan en 403 (401 sin sesión). Las salidas son explícitas: `@Public()` (no requiere sesión), `@AuthenticatedOnly()` (una sesión, sin función) y, para todo lo demás, `@RequirePermission('<función>')`. Un decorator olvidado cierra la ruta en lugar de abrirla.
- **Aplicación.** `BetterAuthGuard` y `PermissionsGuard` se registran globalmente (`common/authorization/global-guards.ts`, incluido en `AppModule` después del throttler). Cada controller solo declara `@RequirePermission('<función>')`. `BetterAuthGuard` responde 401 sin sesión; `PermissionsGuard` responde 403 cuando el mapa no concede la función a los roles de quien llama. Un `@RequirePermission` en un handler individual reemplaza al de la clase.
- **Varios roles.** Better Auth guarda el rol de un usuario como una sola cadena separada por comas (`"admin,user"`). El API la divide por comas, exactamente como Better Auth (sin recortar espacios: los nombres son exactos, con mayúsculas y espacios, así que `"user, admin"` no concede `admin`), y concede una función cuando cualquiera de los roles la tiene; `/me/permissions` devuelve la unión.
- **Endpoint.** `GET /api/me/permissions` devuelve lo que el usuario con sesión puede usar, envuelto como toda respuesta: `{ "data": { "role": "admin", "features": ["dashboard", "dumps", ...] }, "timestamp": "..." }`. Cualquier usuario autenticado puede llamarlo; sin sesión responde 401.
- **Web.** El hook `usePermissions` (`apps/web/src/shared/hooks/usePermissions.ts`) carga esa respuesta después de la sesión. La barra lateral ofrece las secciones cuya función fue concedida, y `ProtectedRoute feature="..."` protege cada ruta con esa misma respuesta. Mientras carga se muestra el loader de la aplicación, así que una sección prohibida nunca parpadea. Un usuario al que no se le concede nada llega a `/no-access` ("No tienes acceso a ninguna sección"), donde cerrar sesión sigue disponible; una visita directa a una dirección prohibida redirige a la primera sección que el usuario puede abrir, o a esa página. La respuesta se guarda en caché por usuario y por sesión, y se descarta al cerrar sesión. Un 401 del endpoint, incluso en una recarga en segundo plano, termina la sesión obsoleta y lleva a la pantalla de inicio de sesión (si la petición de cierre de sesión también falla, esa pantalla sabe que no debe devolver al visitante a la aplicación); cualquier otro fallo, o estar sin conexión, muestra una pantalla con reintentar y cerrar sesión en lugar de un spinner. La web no compara roles: una prueba unitaria falla si vuelve `adminOnly`, `requiredRole` o una comparación `role === '...'`.
- **Pruebas de deriva.** `permission-coverage.spec.ts` (API) carga todos los controllers del árbol de código y falla cuando una ruta no es pública, ni solo de sesión, ni está ligada a una función del mapa, nombra una función ausente de él, o cuando una función no tiene ningún controller detrás. Los controllers públicos (`HealthController`, `AuthController`) y el de solo sesión (`PermissionsController`) son una lista explícita en esa prueba, así que excluir una ruta de los guards exige un cambio revisado ahí. `default-deny.spec.ts` levanta una pequeña app de Nest con los guards globales reales y demuestra que un controller sin decorators responde 401 o 403. En la web, una prueba de la tabla de rutas verifica que la barra lateral y las rutas coinciden para cada sección.
- **La función `users`** no tiene controller de Nest: sus endpoints pertenecen al plugin admin de Better Auth, que aplica sus propios `adminRoles` (por defecto `['admin']`). La entrada del mapa solo gobierna lo que ofrece la web. Un rol que deba gestionar usuarios debe agregarse en ambos lugares.

Para agregar una función: agregue su clave a `PERMISSIONS`, ponga `@RequirePermission('<clave>')` en su controller y agregue la sección (`shared/lib/sections.ts`) y el `ProtectedRoute` en la web; la prueba de cobertura y la lista fija de funciones de `e2e/tests/api/authorization.api.spec.ts` fallan hasta que ambos lados coinciden.

Para agregar un rol (por ejemplo un `viewer` de solo lectura): agréguelo a `ROLES` y enumérelo bajo las funciones que puede usar; el guard, el endpoint y la web no requieren cambios, y la web muestra por su nombre un rol que no tiene traducción. Como hoy una función concede un controller completo, un rol de solo lectura necesita además la división a nivel de endpoint (lecturas y escrituras bajo funciones distintas, o un `@RequirePermission` por handler). Eso es un trabajo posterior en los controllers, no en el guard. El rol `viewer` todavía no existe.

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

1. **`environment` recurre por defecto a `dev`** para mutaciones de recursos cuando la petición no incluye un campo `environment` ni en el body ni en los params. Esto contamina el listado con falsos DEVs. La columna ahora es nullable (migración `1778716800019`), por lo que el fallback a `Environment.DEV` del interceptor podrá removerse — dicho cambio aún no se ha aplicado en el código en ejecución.

2. **Los cronjobs no se auditan en `audit_logs`.** Corren in-process, no por HTTP, así que el interceptor no los ve. Su trazabilidad vive en `backup_jobs.triggeredBy = 'system-cronjob'`. Si se requiere auditoría unificada, debe invocarse el log manualmente desde `CronjobsService.executeCronjob`.

3. **Los logs son append-only a nivel DB.** Un trigger de fila (`audit_logs_immutable`) lanza una excepción ante cualquier `UPDATE` o `DELETE`, y un trigger de sentencia (`audit_logs_no_truncate`) hace lo mismo con `TRUNCATE`, que nunca dispara triggers de fila. El dueño de la tabla todavía puede desactivar o borrar un trigger, así que en producción conviene que `audit_logs` pertenezca a un rol sin inicio de sesión y que el rol de la API solo tenga `SELECT` e `INSERT` sobre ella. Para non-repudiation criptográfico, los registros deberían además firmarse o exportarse a un sistema WORM.

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
| Usuario con sesión válida borra una DB de PROD por error | Bloqueado: eliminar una conexión nunca toca la base de datos a la que apunta; es un soft delete del registro de EnVault y, para PROD, requiere la confirmación reforzada de un admin (nombre exacto + contraseña actual). Editar una conexión PROD o reclasificar una conexión como PROD lanza 403. Ver §1.1 |
| Sesión de admin robada usada para eliminar una conexión PROD | Mitigado: la eliminación requiere la contraseña actual del admin, comprobada en el servidor; 5 contraseñas incorrectas por admin en 15 minutos responden 429 (contador en memoria del proceso, se reinicia al reiniciar). Ver §1.1 |
| Usuario maliciosamente restaura un dump viejo sobre PROD | Bloqueado: `restore` lanza 403 si target environment=PROD |
| Dump exfiltrado vía URL de R2 | Mitigado: bucket privado, acceso vía credenciales R2 (no público) |
| Cookie de sesión robada vía XSS | Mitigado: el flag `httpOnly` impide el acceso de JavaScript a la cookie; CORS strict en prod limita origen |
| DB de control comprometida → leak de credenciales de PROD | Mitigado: passwords cifrados con AES-256-GCM. Requiere `ENCRYPTION_KEY` para descifrar. Ver §4 |
| Audit log adulterado por DBA con acceso | Mitigado: trigger append-only previene UPDATE/DELETE en `audit_logs`. Ver §3 |
| Cronjob apunta a host atacante | Mitigado: cronjob requiere `connectionId` que solo puede crearse via `POST /connections` (auditado) |
| Usuario normal accede a una función de admin porque el API y la UI no coinciden | Mitigado: un único mapa de permisos, aplicado por el API con denegación por defecto y leído por la web desde `GET /api/me/permissions`; una prueba de cobertura falla si un controller se escapa de él. Ver §2 |
| Cuenta de admin comprometida | Rotar `BETTER_AUTH_SECRET` para invalidar todas las sesiones; resetear password del admin vía la API admin de Better Auth |

Las amenazas no mitigadas restantes (SSRF en hosts de conexiones, falta de rotación de credenciales) son **decisiones conscientes** para el alcance actual del sistema (tool interno, equipo pequeño, cloud privado).
