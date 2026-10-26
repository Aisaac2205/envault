# Flujo de Gestión de Bases de Datos

> 🇬🇧 English version: [../en/flow-database-management.md](../en/flow-database-management.md)

## ¿Qué es una "conexión"?

Una conexión (`ConnectionEntity`) representa una base de datos registrada en el sistema. Es la unidad sobre la que operan **backup**, **restore** y **cronjobs**.

No es la base de datos en sí — es **el puntero con credenciales** para acceder a ella.

---

## Campos requeridos al registrar

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| `name` | string (max 100) | sí | Identificador legible para humanos |
| `environment` | `prod` \| `dev` \| `sqa` | sí | Define las reglas de seguridad aplicables |
| `dbType` | `postgres` \| `mysql` | no (default `postgres`) | Determina el motor y las herramientas que se usan |
| `host` | string | sí | Hostname o IP |
| `port` | 1–65535 | sí | Puerto del motor |
| `database` | string | sí | Nombre de la DB dentro del motor |
| `username` | string | sí | Usuario con permisos según el rol |
| `password` | string | sí | Se almacena plaintext, se excluye de las responses (`@Exclude()`) |

### Permisos mínimos del usuario por engine

- **PostgreSQL**: usuario con permiso de `CONNECT`, `pg_dump` requiere `SELECT` sobre todas las tablas a backupear
- **MySQL**: usuario con `SELECT`, `LOCK TABLES`, `SHOW VIEW`, `EVENT`, `TRIGGER`

---

## Endpoints

```
GET    /connections             Lista todas las conexiones activas
GET    /connections/:id         Obtiene una conexión específica
POST   /connections             Crea una conexión (cualquier environment)
PATCH  /connections/:id         Actualiza una conexión (BLOQUEADO si es PROD)
DELETE /connections/:id         Elimina una conexión (PROD: admin con confirmación reforzada, ver abajo)
POST   /connections/test        Testea una conexión por ID en el body
POST   /connections/:id/test    Testea una conexión por ID en la URL
POST   /connections/test-raw    Testea credenciales sin conexión guardada
```

```
GET    /backups/history                Historial de jobs enriquecido con nombre de conexión
POST   /backups                        Crea un backup (connectionId en el body)
POST   /backups/trigger/:connectionId  Disparador manual por connectionId (sin body)
PUT    /backups/settings/:connectionId Configura o actualiza el cronjob de esa conexión
GET    /backups/r2                     Lista objetos crudos en R2
GET    /backups/:id                    Obtiene un backup job por ID
```

Todos los endpoints requieren sesión válida (Better Auth).

---

## Reglas de PROD (invariantes de seguridad)

Una conexión con `environment === 'prod'` es **inmutable** desde la API: no se puede editar ni reclasificar, y un admin solo puede eliminarla con una confirmación reforzada:

| Acción | PROD | DEV / SQA |
|--------|------|-----------|
| Crear (`POST`) | ✅ | ✅ |
| Leer (`GET`) | ✅ | ✅ |
| Testear conexión | ✅ | ✅ |
| Editar (`PATCH`) | ❌ `403 Forbidden` | ✅ (cambiar `environment` a `prod`: ❌ `403 Forbidden`) |
| Eliminar (`DELETE`) | 🔐 nombre exacto + contraseña del admin ([security-model §1.1](security-model.md#11-las-conexiones-prod-son-inmutables-desde-la-api)) | ✅ |
| Hacer backup desde ella | ✅ | ❌ `400 BadRequest` |
| Restaurar hacia ella | ❌ `403 Forbidden` | ✅ |

**Por qué:** PROD es la fuente de verdad. Las modificaciones a una conexión PROD se hacen por **infraestructura/DBA** directamente, no por la aplicación. Esto evita que un usuario con permisos de la API pueda apuntar el job de backup a un host falso.

### ¿Y si necesito quitar o reemplazar una conexión PROD legítimamente?

Un admin la elimina desde la app con una confirmación reforzada: el body del `DELETE` incluye el nombre exacto de la conexión (`confirmName`) y la contraseña actual del admin (`password`), y la web pide ambos datos en un diálogo de confirmación. 5 contraseñas incorrectas en 15 minutos responden `429`. La eliminación es un soft delete que nunca toca la base de datos de producción, y se audita como cualquier otra mutación.

Como la edición sigue bloqueada, credenciales nuevas o un host corregido implican una conexión PROD nueva: ver [devops-runbook §3.2](devops-runbook.md#32-rotar-credenciales-o-corregir-el-host-de-una-conexión). Una vez eliminada la conexión vieja, la app ya no puede restaurar los dumps guardados bajo su slug.

---

## Test de conexión

Hay dos modalidades:

### Por ID (conexión ya guardada)

```http
POST /connections/:id/test
POST /connections/test    { "connectionId": "..." }
```

### Raw (sin guardar — útil al llenar el formulario)

```http
POST /connections/test-raw
{
  "host": "...", "port": 5432, "database": "...",
  "username": "...", "password": "...", "dbType": "postgres"
}
```

Ambas devuelven:

```json
{ "success": true, "latencyMs": 47 }
```

```json
{ "success": false, "latencyMs": 5023, "error": "password authentication failed for user 'foo'" }
```

El test usa el cliente nativo del engine (`pg.Client` para Postgres, `mysql2/promise` para MySQL), no las herramientas CLI. Timeout fijo de **5 segundos**.

---

## Lifecycle

```
                  ┌──────────────────────┐
                  │  POST /connections   │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  ConnectionEntity    │
                  │  isActive: true      │
                  └──────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     environment=prod   env=dev/sqa   POST /:id/test
              │              │              │
              ▼              ▼              ▼
     ┌─────────────┐  ┌─────────────┐  ┌──────────┐
     │ Solo backup │  │ Backup ❌    │  │ Verifica │
     │ Solo lectura│  │ Restore ✅   │  │ creds    │
     │ + test      │  │ Edit ✅      │  └──────────┘
     │ Delete 🔐    │  │ Delete ✅    │
     └─────────────┘  └─────────────┘
              │              │
              ▼              ▼
     POST /backups    POST /restores
     (genera dump)    (consume dump)
              │              ▲
              ▼              │
        Cloudflare R2 ───────┘
```

---

## Historial de backups

`GET /backups/history` devuelve los jobs enriquecidos con el nombre de la conexión:

```json
[
  {
    "id": "...",
    "connectionId": "...",
    "connectionName": "producción-postgres",
    "environment": "prod",
    "status": "completed",
    "fileKey": "backups/.../2026-05-07T02-00-00.dump",
    "fileSizeMb": 142.7,
    "startedAt": "2026-05-07T02:00:00.000Z",
    "completedAt": "2026-05-07T02:01:23.000Z",
    "errorMessage": null,
    "createdAt": "2026-05-07T02:00:00.000Z"
  }
]
```

Si la conexión fue eliminada (soft delete), `connectionName` devuelve `"(eliminada)"`.

---

## Notas operativas

- **Soft delete**: cuando `DELETE` se aplica a una conexión (a una PROD solo con confirmación reforzada), no se elimina físicamente — se marca `isActive: false`. Los backups/restores históricos que la referencian siguen siendo consultables, pero sus dumps ya no se pueden restaurar desde la app.
- **Listado**: `GET /connections` solo devuelve `isActive: true`. No hay endpoint para listar las soft-deleted.
- **Auditoría**: cada `POST`, `PATCH`, `DELETE` queda registrado en `audit_logs` con `userId`, `userEmail`, `action`, `metadata` (el body completo) y `environment`.
- **Streams**: el dump se sube a R2 vía multipart upload (`@aws-sdk/lib-storage`) directamente desde el stdout del proceso — sin escribir en disco.
