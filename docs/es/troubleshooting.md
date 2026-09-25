# Troubleshooting

> 🇬🇧 English version: [../en/troubleshooting.md](../en/troubleshooting.md)

Modos de falla comunes en instalación, configuración y operación, con diagnóstico y fix concretos. Buscá por síntoma; el fix completo está en la sección linkeada.

---

## Índice rápido por síntoma

| Síntoma | Sección |
|---------|---------|
| Dev local: API crashea al arrancar con `relation "X" does not exist` | [§1.1](#11-api-crashea-con-relation-does-not-exist) |
| Dev local: API crashea con `ECONNREFUSED 127.0.0.1:5432` | [§1.2](#12-econnrefused-en-postgres) |
| Dev local: `pnpm install` falla en Windows con EPERM | [§1.3](#13-pnpm-install-falla-en-windows) |
| Dev local: la página de login muestra error o la sesión no persiste | [§1.4](#14-errores-de-login-o-sesion-que-no-persiste) |
| Test de conexión falla: `password authentication failed` | [§2.1](#21-password-authentication-failed) |
| Test de conexión falla: `SSL connection is required` | [§2.2](#22-error-ssl-required) |
| Test de conexión falla: timeout a los 5 segundos | [§2.3](#23-connection-timeout) |
| Test de conexión falla: `no pg_hba.conf entry` | [§2.4](#24-pg_hbaconf-no-entry) |
| Backup se cuelga / nunca termina | [§3.1](#31-backup-se-cuelga) |
| Backup falla: `pg_dump: server version mismatch` | [§3.2](#32-pg_dump-version-mismatch) |
| Restore falla: `403 Forbidden, restore to PROD blocked` | [§3.3](#33-restore-bloqueado-por-regla-prod) |
| Cronjob no se dispara | [§3.4](#34-cronjob-no-se-dispara) |
| Cronjob se dispara dos veces | [§3.5](#35-cronjob-se-dispara-dos-veces) |
| Railway: nginx devuelve 404 en `/` | [§4.1](#41-railway-nginx-404) |
| Railway: web carga con strings de config vacíos | [§4.2](#42-vite-vars-no-quedaron-en-el-build) |
| Railway: `EPROTO SSL alert 40` desde la API | [§4.3](#43-r2-ssl-alert-40) |
| Docker: container del web en restart loop, `99-config.sh: not found` | [§4.4](#44-shebang-de-script-con-crlf) |
| Audit logs muestran todos `environment: dev` aunque sean operaciones PROD | [§5.1](#51-audit-environment-defaultea-a-dev) |

---

## 1. Desarrollo local

### 1.1 API crashea con "relation X does not exist"

**Síntoma**: Los logs de la API muestran `error: relation "backup_jobs" does not exist` al arrancar, después restart loop.

**Causa**: TypeORM usa `synchronize: false` y `migrationsRun: true`. El directorio de migrations no tiene un `CREATE TABLE` para el schema inicial — solo migrations `ALTER TABLE` que asumen que las tablas ya existen.

**Fix**: Generar una migration `InitialSchema`. Procedimiento completo en [database-migrations.md §3](database-migrations.md).

Versión corta:
```bash
docker run --rm --name tmp-pg -e POSTGRES_PASSWORD=tmp -e POSTGRES_DB=envault_tmp -p 5433:5432 -d postgres:16-alpine
DATABASE_URL=postgresql://postgres:tmp@localhost:5433/envault_tmp \
  pnpm --filter @vaultly-control/api migration:generate src/database/migrations/InitialSchema
# Renombrar a 1700000000000-InitialSchema.ts para que corra primero
```

### 1.2 ECONNREFUSED en Postgres

**Síntoma**: `Error: connect ECONNREFUSED 127.0.0.1:5432` al correr `pnpm dev`.

**Causa**: El container local de Postgres no está corriendo.

**Fix**:
```bash
docker ps                         # confirmar que el container 'db' está arriba
pnpm docker:db                    # si no, levantarlo
docker logs db-control_db_1       # chequear logs si el container está unhealthy
```

Si el container está arriba pero la API igual no conecta, chequear que `DATABASE_URL` en `apps/api/.env` apunte a `localhost:5432`, no a `db:5432` (este último solo funciona dentro de Docker Compose).

### 1.3 pnpm install falla en Windows

**Síntoma**: `EPERM: operation not permitted` o errores de symlinks durante `pnpm install`.

**Causa**: Windows requiere Developer Mode o privilegios de admin para crear symlinks, y pnpm los usa mucho.

**Fix**:
1. Activar Developer Mode: Settings → Privacy & Security → For developers → Developer Mode → On.
2. Reiniciar la terminal.
3. Borrar `node_modules` y `pnpm-lock.yaml` si quedó corrupto, después `pnpm install` de nuevo.

Alternativa: correrlo desde WSL2 donde los symlinks funcionan nativos.

### 1.4 Errores de login o sesión que no persiste

**Síntoma**: El formulario de login devuelve error, o el usuario se logueó pero la sesión se pierde al refrescar la página.

**Causas y fixes comunes**:

| Síntoma | Causa | Fix |
|---------|-------|-----|
| `BETTER_AUTH_SECRET is not set` en logs de la API | Variable de entorno faltante | Setear `BETTER_AUTH_SECRET` en `apps/api/.env` |
| Login exitoso pero sesión perdida inmediatamente | Mismatch en el dominio de la cookie | Confirmar que `BETTER_AUTH_URL` coincide con el origen exacto que usa el browser (incluyendo `http://localhost:3000` en dev) |
| `401 Unauthorized` en todos los requests a la API después de loguearse | CORS mal configurado — `credentials: 'include'` no seteado o `CORS_ORIGIN` incorrecto | En dev asegurar `CORS_ORIGIN=http://localhost:5173`; en prod usar el dominio exacto del frontend |
| Strings vacíos en `window.APP_CONFIG` | Falta `.env` o vars `VITE_*` no expuestas | Confirmar que `apps/web/.env` existe con `VITE_API_URL` seteado |

---

## 2. Conexiones a bases de datos

### 2.1 Password authentication failed

**Síntoma**: El test de conexión devuelve `{ "success": false, "error": "password authentication failed for user 'X'" }`.

**Diagnóstico desde el host de EnVault Management**:
```bash
PGPASSWORD='<password>' psql -h <host> -p <port> -U <user> -d <database> -c '\conninfo'
```

Si funciona desde CLI pero falla en EnVault Management, la diferencia está en las credenciales que tipeaste. Si también falla desde CLI, el password está mal o el usuario no existe en la DB.

### 2.2 Error SSL required

**Síntoma**: El test devuelve `error: SSL/TLS required` o `the server does not support SSL, but SSL was required`.

**Causa**: La DB gestionada obliga SSL (Neon, Supabase, Azure Flexible Server, RDS con `force_ssl=1`). EnVault Management no expone el parámetro `sslmode` en la UI hoy.

**Workarounds**:
1. **Apagar la obligatoriedad de SSL en el proveedor** (solo en RDS con parameter group changes, Azure Single Server, Cloud SQL con non-SSL permitido). **No recomendado para producción**.
2. **Self-hostear un proxy con terminación SSL** delante de la DB (HAProxy, pgBouncer con TLS).
3. **Esperar el feature nativo de SSL** (trackeado en [architecture-roadmap.md](architecture-roadmap.md)).

Detalles por proveedor: [connecting-cloud-databases.md §3](connecting-cloud-databases.md).

### 2.3 Connection timeout

**Síntoma**: El test se cuelga 5 segundos y devuelve `latencyMs: 5000+, error: connection timeout`.

**Diagnóstico desde el host de EnVault Management**:
```bash
nc -zv <host> <port>             # confirmar alcanzabilidad TCP
ping <host>                       # confirmar que el hostname resuelve
traceroute <host>                 # confirmar que el camino no está bloqueado
```

**Causas comunes**:
- El allowlist del proveedor no incluye la IP de egress del host de EnVault Management.
- Security group / firewall rule bloqueando inbound desde la IP de EnVault Management.
- La DB está detrás de una VPN/red privada y EnVault Management no (ver [connecting-on-premise-databases.md](connecting-on-premise-databases.md)).
- Puerto mal (ej: `5433` cuando la DB escucha en `5432`).

### 2.4 pg_hba.conf no entry

**Síntoma**: `no pg_hba.conf entry for host "X.X.X.X", user "Y", database "Z"`.

**Causa**: El archivo de host-based auth de PostgreSQL rechaza la IP origen. Común en Postgres self-hosted sin líneas `host` para la subred de EnVault Management.

**Fix del lado de la DB** (`pg_hba.conf`):
```
host    <database>    <user>    <envault-cidr>    md5
```

Después `SELECT pg_reload_conf();` o reiniciar Postgres.

---

## 3. Backups, restores, cronjobs

### 3.1 Backup se cuelga

**Síntoma**: El job de backup queda en estado `running` indefinidamente. Sin error.

**Causas posibles**:
- La DB tiene tablas muy grandes y `pg_dump` está laburando genuinamente — chequear logs de la API por progreso, monitorear tamaño del bucket de R2.
- Caída de red entre EnVault Management y la DB origen droppeó la conexión silenciosamente (sin retry hoy).
- Upload a R2 estancado (raro — `@aws-sdk/lib-storage` maneja multipart bien).

**Diagnóstico**:
```bash
# En el container/host de la API de EnVault Management:
ps aux | grep pg_dump            # ¿el proceso de dump sigue vivo?
docker stats envault-api          # uso de CPU/memoria/red
# Chequear bucket R2: ¿se están subiendo nuevas parts?
```

**Fix hoy**: matar y reintentar. El estado del backup job hay que actualizarlo manualmente en la DB (`UPDATE backup_jobs SET status='failed' WHERE id='...'`) — no hay botón de cancelar en la UI.

### 3.2 pg_dump version mismatch

**Síntoma**: El backup falla con `pg_dump: error: server version: 16.x; pg_dump version: 15.x; aborting because of server version mismatch`.

**Causa**: El container de la API de EnVault Management trae una versión específica de `pg_dump`. `pg_dump` tiene que ser **≥** la versión del server origen. Si tu DB gestionada se actualizó a Postgres 17 y el container de EnVault Management trae `pg_dump` 16, los dumps se rompen.

**Fix**: Actualizar [`apps/api/Dockerfile`](../../apps/api/Dockerfile) para instalar una versión más nueva de `postgresql-client`. Buscar el build arg `POSTGRES_CLIENT_VERSION` o la línea `apt-get install postgresql-client-X`, subirla, rebuild, redeploy.

### 3.3 Restore bloqueado por regla PROD

**Síntoma**: El restore devuelve `403 Forbidden: cannot restore into PROD environment`.

**Causa**: Por diseño — restaurar sobre una conexión PROD está bloqueado en la capa de service ([security-model.md §1.3](security-model.md)). Es un feature, no un bug.

**Si genuinamente necesitás restaurar datos productivos**: restaurá a una conexión DEV/SQA primero, validá, y después que un DBA haga el restore real a PROD manualmente fuera de EnVault Management con gestión de cambios apropiada.

### 3.4 Cronjob no se dispara

**Síntoma**: Cronjob está configurado y `isActive: true`, pero `lastRunAt` nunca se actualiza.

**Diagnóstico**:
```sql
-- Conectar a la DB de control
SELECT id, name, cron_expression, is_active, last_run_at, next_run_at, last_status
FROM cronjobs WHERE name = '<nombre del job>';
```

**Causas comunes**:
- `nextRunAt` está en el pasado pero `isActive: false` — activalo.
- La API se reinició y el cronjob no se re-registró (no debería pasar — `OnApplicationBootstrap` los recarga — pero chequeá logs).
- La expresión cron es inválida; verificá con `crontab.guru`.
- Timezone del server vs expresión cron desalineados (cron corre en la TZ del container — `docker exec envault-api date`).

### 3.5 Cronjob se dispara dos veces

**Síntoma**: Dos backup jobs creados con segundos de diferencia para el mismo cronjob.

**Causa**: Casi seguro **múltiples réplicas de la API corriendo**. El scheduler actual es single-replica por diseño ([scheduler-architecture.md](scheduler-architecture.md)). Cada réplica registra y dispara todos los cronjobs.

**Fix**: bajar el service de la API a 1 réplica hasta que se implemente la migración a BullMQ + Redis (también en [architecture-roadmap.md](architecture-roadmap.md)).

---

## 4. Deployment (Railway)

### 4.1 Railway nginx 404

**Síntoma**: El service web está healthy en Railway pero devuelve 404 en `/`.

**Causa**: El target port en la config del service de Railway no matchea el puerto que expone el Dockerfile (nginx escucha en 80).

**Fix**: Service → Settings → Networking → Target Port = `80`.

### 4.2 Vite vars no quedaron en el build

**Síntoma**: El web carga pero las URLs están vacías o contienen literalmente `undefined`.

**Causa**: Las variables `VITE_*` tienen que existir **en build time**, no solo en runtime. Railway las pasa como build args automáticamente solo si están declaradas como Service Variables (no Shared, no Project).

**Fix**:
1. Confirmar que las vars están en la pestaña Variables del service web, scope = Service.
2. Confirmar que el Dockerfile las declara como `ARG`.
3. Disparar un redeploy (rebuild — no solo restart).

### 4.3 R2 SSL alert 40

**Síntoma**: Los logs de la API muestran `EPROTO ... SSL alert 40` al intentar subir a R2.

**Causa**: `R2_ACCOUNT_ID` está mal, produciendo un hostname de endpoint inválido. A menudo se confunde con `R2_ACCESS_KEY_ID`.

**Fix**: Verificar `R2_ACCOUNT_ID` en el Cloudflare Dashboard (arriba a la derecha en cualquier pantalla de cuenta, hex de 32 chars). Es **distinto** de `R2_ACCESS_KEY_ID` (que se genera al crear un R2 API Token).

### 4.4 Shebang de script con CRLF

**Síntoma**: Container del web en restart loop, error `/docker-entrypoint.d/99-config.sh: not found` aunque el archivo existe.

**Causa**: El archivo `.sh` tiene line endings de Windows (CRLF) en vez de LF. Linux lee el shebang como `#!/bin/sh\r`, intenta encontrar un intérprete llamado literalmente `/bin/sh\r`, falla, devuelve `exit 127`.

**Diagnóstico**:
```bash
head -1 entrypoint.sh | od -c | head -1
# Si ves "\r \n" al final, ese es el bug
```

**Fix**:
```bash
sed -i 's/\r$//' apps/web/entrypoint.sh
```

**Preventivo**: el `.gitattributes` del repo ya fuerza LF para `*.sh`, `*.envsh`, `Dockerfile`, `nginx.conf`, `*.conf.template`, `docker-compose*.yml`. Asegurate que los nuevos contributors clonen con ese archivo presente.

---

## 5. Audit & operaciones

### 5.1 Audit environment defaultea a dev

**Síntoma**: El dashboard de audit log muestra `environment: dev` para operaciones en conexiones PROD.

**Causa**: Limitación conocida. El `AuditInterceptor` lee `environment` del body/params de la request. Para operaciones que no lo incluyen (ej: reads), defaultea a `dev`. Ver [security-model.md §3 limitación 1](security-model.md).

**Fix definitivo**: requiere una migration para hacer `AuditLogEntity.environment` nullable, después actualizar el interceptor para escribir `null` en vez de defaultear. No hecho hoy.

**Workaround**: filtrar el dashboard por `resourceId` (el UUID de la conexión) y cruzar con el environment real de la conexión.

---

## ¿Seguís trabado?

1. **Chequeá los logs**:
   - Local: output de `pnpm dev`, o `docker compose logs -f api web`.
   - Railway: Service → Deployments → click en el último → View Logs.

2. **Chequeá la base de datos**:
   ```sql
   SELECT * FROM backup_jobs ORDER BY created_at DESC LIMIT 10;
   SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;
   SELECT * FROM cronjobs WHERE is_active = true;
   ```

3. **Pedí ayuda**: abrí un issue en el repo con logs, env scrubbed de secretos, y los pasos exactos que llevan al fallo.
