# Conectar Bases de Datos Cloud (Gestionadas)

> 🇬🇧 English version: [../en/connecting-cloud-databases.md](../en/connecting-cloud-databases.md)

Guía para DevOps que quieren registrar una **base de datos gestionada/cloud** (Neon, AWS RDS, Supabase, Azure Database for PostgreSQL, Google Cloud SQL, Railway Postgres, etc.) como conexión en EnVault Management.

> **Alcance**: cubre las **bases gestionadas que vas a backupear**, no la DB de control de EnVault Management. La de control siempre tiene que ser PostgreSQL 16+ — ver la sección de requisitos del [README](../../README.es.md).

---

## 1. Qué hace (y qué NO hace) EnVault Management hoy

Leé esto antes de gastar una hora debuggeando.

| Capacidad | Estado |
|-----------|--------|
| Conexión TCP directa a PostgreSQL / MySQL | ✅ Nativo |
| Handshake SSL/TLS | ⚠️ **Vía parámetros en la connection string** (`sslmode=require`, etc.) — EnVault Management no valida ni pinea certificados por sí mismo |
| CA personalizada / certificados de cliente | ❌ No expuesto en la UI hoy |
| SSH tunneling | ❌ No es nativo — manejarlo externamente (ver [guía on-prem](connecting-on-premise-databases.md)) |
| Connection pooling (pgBouncer) | ➕ Usá el endpoint pooled del proveedor directamente |
| Validación de IP allowlist | ❌ No validado por EnVault Management — se maneja en el proveedor |
| Reintentos / backoff | ❌ Un solo intento con timeout de 5 segundos |

**Bottom line**: SSL funciona si el driver de abajo respeta los parámetros de la connection string (lo hace, tanto `pg` como `mysql2`). Lo que falta es **soporte de primera clase en UI/configuración** para opciones de SSL y tunneling. Ver [architecture-roadmap.md](architecture-roadmap.md) para el diseño planificado.

---

## 2. Prerrequisitos — checklist

Antes de registrar una conexión cloud:

- [ ] Tenés host, puerto, nombre de la DB, usuario y password.
- [ ] El usuario tiene los permisos mínimos por engine ([doc del flujo, §permisos](flow-database-management.md)).
- [ ] La DB es alcanzable desde la red donde corre EnVault Management (endpoint público, o VPC peering, o private endpoint resoluble).
- [ ] La IP del host donde corre EnVault Management está en el allowlist del proveedor (si usa uno — la mayoría sí).
- [ ] Sabés si el proveedor obliga SSL (la mayoría modernos sí — Neon y Supabase lo obligan siempre).

---

## 3. Recetas por proveedor

### 3.1 Neon (Postgres serverless)

Neon **siempre obliga SSL** y soporta endpoints pooled y directos.

**Formato de connection string** (desde el dashboard de Neon):

```
postgresql://<user>:<password>@<endpoint>.neon.tech/<database>?sslmode=require
```

Para conexiones pooled (recomendado para queries largas tipo `pg_dump`):

```
postgresql://<user>:<password>@<endpoint>-pooler.neon.tech/<database>?sslmode=require
```

**En la UI de EnVault Management**, descomponé así:

| Campo | Valor |
|-------|-------|
| Host | `<endpoint>.neon.tech` o `<endpoint>-pooler.neon.tech` |
| Port | `5432` |
| Database | `<database>` |
| Username | `<user>` |
| Password | `<password>` |
| DB Type | `postgres` |

**El `sslmode=require`**: la UI de EnVault Management no tiene un campo para eso. **Workaround hoy**: si tu proveedor obliga SSL y rechaza conexiones sin SSL, la conexión va a fallar hasta que el manejo de SSL esté expuesto nativamente (ver roadmap). Para Neon específicamente, esto significa que las conexiones desde EnVault Management **van a fallar hoy** con errores `SSL required`.

> **Status honesto**: Neon, Supabase y cualquier proveedor que obligue SSL no están plenamente soportados por el code path actual de EnVault Management. Workarounds: self-hostear un proxy de Postgres que termine SSL, o esperar el feature nativo. Trackear en [architecture-roadmap.md](architecture-roadmap.md).

### 3.2 AWS RDS / Aurora (Postgres o MySQL)

RDS es **el target más amigable hoy** porque SSL puede ser opcional u obligatorio según tu parameter group.

**Si tu RDS NO obliga SSL** (default a menos que hayas activado `rds.force_ssl=1`):

| Campo | Valor |
|-------|-------|
| Host | `<instance>.<region>.rds.amazonaws.com` |
| Port | `5432` (Postgres) / `3306` (MySQL) |
| Database | nombre de tu DB |
| Username | master user o un usuario dedicado de backup |
| Password | desde Secrets Manager o tu vault |
| DB Type | `postgres` o `mysql` |

**Requerimientos de red**:

- El host de EnVault Management tiene que estar dentro de la VPC de RDS, o usar VPC peering, o habilitás public accessibility en la instancia RDS Y agregás la IP de egress de EnVault Management al security group inbound.
- **Para producción recomendamos fuertemente VPC peering o PrivateLink**, no public accessibility. Exponer RDS al internet público es un red flag de compliance incluso con SSL.

**Si tu RDS obliga SSL**: misma limitación que Neon — esperar el feature nativo o terminar SSL fuera de EnVault Management.

### 3.3 Supabase

Supabase obliga SSL siempre, misma restricción que Neon. Usá el endpoint **pooler** (`aws-0-<region>.pooler.supabase.com:6543`) y un rol con privilegios de `SELECT`.

Status: igual que Neon — bloqueado por soporte nativo de SSL.

### 3.4 Azure Database for PostgreSQL / MySQL

Azure obliga SSL por default en Flexible Server. Mismo bloqueo. En Single Server (deprecado) podés apagar SSL, lo cual funciona hoy pero **no** se recomienda para producción.

### 3.5 Google Cloud SQL

Cloud SQL soporta modos SSL-required y SSL-optional. Si está en **"Allow non-SSL connections"**, EnVault Management conecta bien. Si no, mismo bloqueo.

Para setup con IP privada: asegurate que EnVault Management corra en la misma VPC o en una red peered.

### 3.6 Railway Postgres (plugin)

El plugin de Postgres de Railway te da reference variables (`${{Postgres.PGHOST}}` etc.). **No** obliga SSL en conexiones internas dentro del mismo project, así que funciona hoy sin workarounds.

| Campo | Valor |
|-------|-------|
| Host | `${{Postgres.PGHOST}}` (o el proxy externo si conectás desde afuera de Railway) |
| Port | `${{Postgres.PGPORT}}` |
| Database | `${{Postgres.PGDATABASE}}` |
| Username | `${{Postgres.PGUSER}}` |
| Password | `${{Postgres.PGPASSWORD}}` |

Para acceso externo (EnVault Management hosteado fuera de Railway), usar el TCP proxy público que expone Railway — mismas credenciales, host/port distinto.

---

## 4. Topologías de red — elegí una

```
┌──────────────────────────────────────────────────────────────────┐
│  Opción A: Endpoint público + IP allowlist (más simple)          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐  HTTPS   ┌─────────┐  TCP   ┌──────────────────┐  │
│   │ EnVault Management  │ ────────▶│Proveedor│ ──────▶│ Managed DB (pub) │  │
│   │          │          │   API   │        │ con allowlist de │  │
│   │          │ ◀────────│         │ ◀──────│ la IP de EnVault Management │  │
│   └──────────┘          └─────────┘        └──────────────────┘  │
│                                                                  │
│  ✅ El setup más rápido                                          │
│  ⚠️  Endpoint público = escrutinio de auditoría/compliance       │
│  ⚠️  Requiere SSL para cualquier dato sensible                   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Opción B: Misma VPC (recomendada para producción)               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌────────────────── VPC / VNet ──────────────────┐             │
│   │  ┌──────────┐                ┌──────────────┐  │             │
│   │  │ EnVault Management  │ ─── subnet ───▶│  Managed DB  │  │             │
│   │  │          │     privada   │  (IP privada)│  │             │
│   │  └──────────┘                └──────────────┘  │             │
│   └────────────────────────────────────────────────┘             │
│                                                                  │
│  ✅ Sin exposición pública                                       │
│  ✅ Menor latencia, menos saltos                                 │
│  ⚠️  Requiere que EnVault Management corra en la cuenta cloud               │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Opción C: VPC peering / PrivateLink (cross-account)             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌── VPC A ──┐                              ┌── VPC B ──┐       │
│   │ EnVault Management   │ ◀──── peering / PL ────────▶│ Managed DB│       │
│   └───────────┘                              └───────────┘       │
│                                                                  │
│  ✅ Grado producción para orgs multi-cuenta                      │
│  ⚠️  Más setup (route tables, security groups, DNS)              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Testear la conexión antes de guardar

EnVault Management tiene `POST /connections/test-raw` que prueba la conexión con timeout de 5 segundos. Desde la UI, el botón "Test Connection" lo invoca.

Si el test falla, el mensaje viene directo del driver. Comunes:

| Error del driver | Causa real | Fix |
|------------------|------------|-----|
| `connection timeout` después de 5s | Red inalcanzable, host mal, security group bloqueando | Probar con `pg_isready -h <host> -p <port>` desde el host de EnVault Management. Chequear firewall/SG. |
| `password authentication failed` | User/password mal, o el usuario no existe | Verificar el password conectando con `psql` o `mysql` desde la misma máquina. |
| `SSL connection is required` | El proveedor obliga SSL, EnVault Management no pasa `sslmode=require` | **Bloqueado hoy** — ver §3.1 / roadmap. |
| `database "X" does not exist` | Typo, o el usuario no tiene `CONNECT` | `\l` en psql para listar DBs visibles. |
| `role "X" cannot login` | El usuario existe pero `NOLOGIN` | `ALTER ROLE X LOGIN;` |
| `no pg_hba.conf entry for host` | La auth basada en host rechaza la IP | Agregar la IP de egress de EnVault Management al allowlist. |

---

## 6. Tips operativos

- **Usá un usuario dedicado por conexión de EnVault Management.** No el master/admin. Concedé solo los permisos mínimos. Si la credencial se filtra, el blast radius queda acotado.
- **Rotá passwords periódicamente.** Hoy EnVault Management los guarda en plaintext en la DB de control ([security-model.md, §4](security-model.md)) — la rotación es tu defensa en profundidad.
- **Nombrá las conexiones descriptivamente.** `prod-billing-postgres` es mejor que `db1`. Los nombres aparecen en audit logs e historial.
- **Pineá la versión del engine**, cuando puedas. `pg_dump` tiene que ser ≥ la versión del server origen. Si tu managed DB es Postgres 16 y el container de EnVault Management trae `pg_dump` 15, los dumps van a fallar con un error de versión.
- **Monitoreá costos de egress.** El tráfico cross-region o cross-AZ desde tu managed DB al host de EnVault Management se cobra en la mayoría de los proveedores. Co-locá cuando puedas.

---

## 7. Qué viene (roadmap, no implementado)

Ver [architecture-roadmap.md](architecture-roadmap.md) para el diseño. Headlines:

- Configuración nativa de SSL (mode, CA cert, client cert) en UI y schema.
- Soporte de SSH tunnel integrado nativamente.
- Abstracción de driver por engine (Postgres / MySQL / MongoDB / MSSQL).
- Validación de allowlist en `host`/`port` (bloquear `localhost`, `169.254.x.x`, etc.).
