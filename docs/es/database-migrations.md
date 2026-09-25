# Database Migrations — Guía Operativa

> 🇬🇧 English version: [../en/database-migrations.md](../en/database-migrations.md)

> **Audiencia**: cualquier dev que necesite levantar la API contra una DB nueva, o sumar/correr migrations.

---

## 1. El problema que esta guía resuelve

El proyecto usa **TypeORM con `synchronize: false` + `migrationsRun: true`** (ver [`database.config.ts`](../src/config/database.config.ts)). Eso significa:

- La API NO crea tablas automáticamente desde las `@Entity` al arrancar.
- La API SÍ corre todas las migrations del directorio `src/database/migrations/` en orden al arrancar.

**Estado al momento de escribir esta guía**: todas las migrations existentes son `ALTER TABLE` / `addColumn` que **asumen tablas pre-existentes**. No hay ninguna migration que ejecute `CREATE TABLE` para el esquema inicial.

Consecuencia: si levantás la API contra una DB Postgres vacía (un entorno nuevo, un container fresh, un test de CI), la primera migration intenta `ALTER TABLE backup_jobs ...` y Postgres responde:

```
ERROR: relation "backup_jobs" does not exist
```

La app crashea y queda en restart loop.

---

## 2. Por qué NO resolvemos esto con un DDL manual

> Esta sección existe porque "tengo un init.sql, lo corro a mano y listo" es la primera tentación. Es una mala idea. Acá está por qué.

### 2.1 Drift entre entities y SQL

La fuente de verdad del schema son los archivos `*.entity.ts`. Si introducimos un `init.sql` paralelo:

- Hoy: entities y SQL coinciden.
- Mes 1: alguien agrega `@Column() phone: string` a `ConnectionEntity`. Olvida actualizar `init.sql`.
- Mes 2: nuevo dev clona el repo, corre el `init.sql`, levanta la API → todo funciona... hasta que un `INSERT` rompe en producción porque la columna `phone` no existe.
- Debugging: 3 horas mínimo. El error está lejos de la causa.

Con migrations versionadas, **agregar una columna implica generar una migration**, así que la divergencia es estructuralmente imposible.

### 2.2 Tabla `migrations` desincronizada

TypeORM mantiene una tabla interna llamada `migrations` con el registro de qué migrations ya fueron aplicadas. Si creamos las tablas con un DDL manual:

1. Las tablas existen ✅
2. La tabla `migrations` queda vacía ❌
3. Al arrancar la API, `migrationsRun: true` re-ejecuta TODAS las migrations
4. Las migrations actuales están bien defendidas con `hasColumn()`, así que el `addColumn` se saltea — pero los **`UPDATE` de backfill** (ver [`1715200000000-add-dbtype-to-backup-jobs.ts:27-33`](../src/database/migrations/1715200000000-add-dbtype-to-backup-jobs.ts)) se ejecutan igual. En una DB vacía es no-op; en una DB con datos podría sobreescribirlos.

### 2.3 No es reproducible

El día que sumemos staging, QA, un cliente nuevo, CI, runners efímeros... cada entorno necesita el DDL aplicado por un humano. Con migrations: `docker compose up` y la API se auto-aprovisiona contra una DB vacía. Siempre. Sin intervención.

### 2.4 Margen de error humano al escribir el DDL

Reproducir a mano todos los `CREATE TABLE`, tipos enum (TypeORM crea uno por columna), FKs, índices únicos, defaults, casts y constraints de 5 entities es **garantía de bug**. El CLI de TypeORM lo genera automáticamente desde las entities, sin posibilidad de error.

---

## 3. La solución: generar una migration `InitialSchema`

### 3.1 Idea general

Vamos a generar **una sola migration** que cree todas las tablas desde el estado actual de las entities. La nombramos `InitialSchema` y le ponemos un timestamp anterior a todas las migrations existentes (la más vieja hoy es `1715200000000`). Así, el orden cronológico al arrancar queda:

```
1700000000000-InitialSchema.ts                              ← CREATE TABLE de todo
1715200000000-add-dbtype-to-backup-jobs.ts                  ← ALTER ya existente
1746662400000-RenameAuditUserEmailToUsername.ts             ← ALTER ya existente
1778716800001-add-slug-to-connections.ts                    ← ALTER ya existente
... (resto en orden)
```

Las migrations existentes ya están defendidas con `hasColumn()` / `await queryRunner.hasColumn(...)`, así que si la `InitialSchema` crea las tablas ya con las columnas modernas, las migrations posteriores las saltean correctamente. **El equipo lo diseñó bien defensivamente.**

### 3.2 Pre-requisitos (una sola vez)

Necesitamos `ts-node` instalado como devDep para que el CLI de TypeORM pueda leer los `.entity.ts` sin compilar:

```bash
pnpm --filter @vaultly-control/api add -D ts-node
```

> Ya están agregados los scripts `migration:*` en [`apps/api/package.json`](../package.json) y el archivo [`apps/api/src/data-source.ts`](../src/data-source.ts).

### 3.3 Paso a paso

**Paso 1 — Levantar una Postgres vacía**

El CLI de TypeORM compara las entities contra el estado actual de la DB para calcular el diff. Necesitamos una DB **vacía** para que el diff sea "creá todo desde cero".

Opción A (rápida, recomendada): un container temporal aparte:

```bash
docker run --rm --name tmp-pg -e POSTGRES_PASSWORD=tmp -e POSTGRES_DB=envault_tmp -p 5433:5432 -d postgres:16-alpine
```

> Usamos puerto `5433` en el host para no chocar con el `db` del compose principal.

Opción B (con compose, si querés): levantá `docker compose up db` con un volumen limpio (`docker volume rm db-control_db_data` antes).

**Paso 2 — Generar la migration**

```bash
# Apuntamos la env a la DB temporal vacía
$env:DATABASE_URL = "postgresql://postgres:tmp@localhost:5433/envault_tmp"

# Generamos
pnpm --filter @vaultly-control/api migration:generate src/database/migrations/InitialSchema
```

Esto crea un archivo tipo `src/database/migrations/<timestamp>-InitialSchema.ts` con todos los `CREATE TABLE`, FKs, enums, índices y defaults derivados de las 5 entities.

**Paso 3 — Renombrar el timestamp**

El archivo generado tendrá un timestamp del momento actual (mayor que las migrations existentes). Hay que renombrarlo para que se ejecute **primero**:

```
<timestamp-actual>-InitialSchema.ts   →   1700000000000-InitialSchema.ts
```

Y dentro del archivo, ajustar también el nombre de la clase si TypeORM la generó con timestamp:

```ts
export class InitialSchema1700000000000 implements MigrationInterface { ... }
```

**Paso 4 — Verificar el archivo**

Abrir el archivo generado y validar que:

- Hay un `CREATE TABLE` para cada una de las 5 entities (`connections`, `backup_jobs`, `restore_jobs`, `audit_logs`, `cronjobs` — chequear nombres reales en cada `@Entity('...')`).
- Los tipos enum tienen `CREATE TYPE ... AS ENUM (...)` correspondientes.
- Las FKs entre tablas existen donde corresponde.
- Los índices únicos (ej. `IDX_connections_slug_unique`) están presentes.

**Paso 5 — Probar el flow completo contra DB limpia**

```bash
# Bajá la DB del compose principal (con volumen limpio)
docker compose down -v

# Levantala fresca
docker compose up db -d

# Esperá unos segundos y arrancá la API
docker compose up api
```

Si la API loguea las migrations aplicadas en orden y queda escuchando en `:3000` sin errores, **funcionó**.

**Paso 6 — Cleanup**

```bash
docker stop tmp-pg
```

Y commiteá: el `data-source.ts`, el `package.json` actualizado, y el archivo `1700000000000-InitialSchema.ts`.

---

## 4. Flujo para futuras migrations

Una vez que existe la migration inicial, **cualquier cambio futuro al schema sigue este flujo**:

1. Modificás una entity (agregás `@Column`, cambiás tipo, agregás índice, etc.).
2. Levantás una DB con el schema actual (puede ser la de `docker compose up db`).
3. Generás la migration nueva:
   ```bash
   pnpm --filter @vaultly-control/api migration:generate src/database/migrations/<NombreDescriptivo>
   ```
4. Revisás el SQL que generó.
5. Commiteás entity + migration **juntas, en el mismo PR**.

> ⚠️ **Nunca modificar una migration ya commiteada y aplicada en cualquier entorno.** Si necesitás corregir algo, generá una migration nueva que arregle el problema. Una migration es inmutable después del primer `migration:run` en cualquier entorno.

---

## 5. Comandos disponibles (ya configurados en `package.json`)

| Comando | Uso |
|---|---|
| `pnpm --filter @vaultly-control/api migration:generate <path>` | Genera migration con el diff entre entities y DB actual |
| `pnpm --filter @vaultly-control/api migration:create <path>` | Crea archivo de migration vacío (para migrations manuales tipo backfill) |
| `pnpm --filter @vaultly-control/api migration:run` | Aplica migrations pendientes (lo hace la app sola con `migrationsRun: true`, pero útil para debugging) |
| `pnpm --filter @vaultly-control/api migration:revert` | Revierte la última migration aplicada |
| `pnpm --filter @vaultly-control/api migration:show` | Lista qué migrations están aplicadas y cuáles pendientes |

Todos requieren `DATABASE_URL` seteada en el environment.

---

## 6. FAQ

**¿Por qué no `synchronize: true` en dev y migrations en prod?**

Porque divergen sin que te des cuenta. En dev `synchronize` hace cualquier cambio mágicamente; en prod las migrations son la única vía. Resultado: lo que en dev "funciona", en prod requiere una migration que nadie escribió. Migrations en todos los entornos = single source of truth.

**¿Y si me equivoco al generar la migration?**

Borrá el archivo `.ts` generado, ajustá lo que haga falta en las entities, y volvé a generar. Mientras no la hayas commiteado/aplicado en ningún entorno, no pasa nada.

**¿Por qué hay un `data-source.ts` además del `database.config.ts`?**

Porque el CLI de TypeORM corre fuera de NestJS y necesita un export plano de tipo `DataSource`. Está explicado en el comentario al principio del archivo [`data-source.ts`](../src/data-source.ts).

**¿La migration inicial puede romper algo en entornos que ya existen (prod actual)?**

No. Si la DB ya tiene las tablas, TypeORM solo registra la migration como "ya aplicada" en la tabla `migrations` la primera vez que se corra `migration:run` con `--fake` (o se puede hacer un `INSERT` manual a `migrations`). Para entornos que ya tienen el schema, el flow es:

```sql
INSERT INTO migrations (timestamp, name) VALUES (1700000000000, 'InitialSchema1700000000000');
```

Esto marca la migration como aplicada sin ejecutarla. Solo aplica a entornos LEGACY que ya tienen tablas.

**Pusheé una imagen con una migration que tenía un bug. ¿Sobrescribo el mismo tag o bumpeo versión?**

**Bumpeás versión.** Los tags de imagen Docker deben tratarse como inmutables: una vez que `envault-api:0.1.0` está publicado, ese contenido debe quedar fijo para siempre. Si alguien (un compañero, CI, un cliente) ya hizo `docker pull` de ese tag, su cache local tiene la versión rota. Sobrescribir el tag en Hub NO actualiza esos caches — siguen corriendo lo viejo hasta que pidan pull explícito. Bumpeando a `0.1.1` (o `0.1.0-fix1` si querés señalizar que es un hotfix), todo entorno que lo pida baja la versión nueva, sin ambigüedad. La regla general: **una versión = un contenido inmutable, para siempre**.

**Mi container del web entra en restart loop con `exit 127` y dice `99-config.sh: not found` aunque el archivo existe. ¿Qué pasa?**

Tu archivo `.sh` tiene line endings de Windows (CRLF `\r\n`) en vez de Unix (LF `\n`). Linux lee la primera línea como `#!/bin/sh\r` y trata de encontrar el intérprete `/bin/sh\r` (con el `\r` colgado), no lo encuentra, y devuelve "command not found" → exit 127. El mensaje es engañoso: no es el SCRIPT que falta, es el INTÉRPRETE de la shebang. Verificá con `bash -c "head -1 archivo.sh | od -c"` — si ves `\r \n` al final, ese es el bug. Fix rápido: `sed -i 's/\r$//' archivo.sh` y rebuild. Fix preventivo: el `.gitattributes` de la raíz ya fuerza LF para `*.sh`, `*.envsh`, `Dockerfile`, `nginx.conf`, `*.conf.template` y `docker-compose*.yml` desde el clone, así cualquier dev en Windows queda cubierto.
