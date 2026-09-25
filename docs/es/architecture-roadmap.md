# Roadmap de Arquitectura

> ⚠️ **STATUS: DISEÑO PROPUESTO — NO IMPLEMENTADO**
>
> Este documento describe la **arquitectura target** de la capa de conexiones de EnVault Management. Al 2026-05-14, el código implementa **solo conexiones TCP directas**, sin soporte de primera clase para SSL, SSH tunneling, ni abstracción de drivers. Ver [architecture.md](architecture.md) para la implementación actual.
>
> El propósito de este documento es dar a usuarios DevOps y contributors una visión clara de **hacia dónde va el proyecto**, para que:
> 1. Las decisiones de diseño que se toman hoy sean compatibles con el target.
> 2. Los contributors sepan qué construir a continuación sin re-inventar el diseño.
> 3. Los usuarios evaluando EnVault Management puedan juzgar si la trayectoria matchea sus necesidades.

> 🇬🇧 English version: [../en/architecture-roadmap.md](../en/architecture-roadmap.md)

---

## 1. Motivación

La capa de conexiones actual tiene tres problemas:

1. **Sin soporte de primera clase para SSL/TLS.** Los proveedores gestionados que obligan SSL (Neon, Supabase, Azure Flexible Server, RDS con `force_ssl`) no se pueden usar sin workarounds. Ver [connecting-cloud-databases.md §3](connecting-cloud-databases.md).

2. **Sin SSH tunneling.** Las DBs on-prem requieren setup de túnel externo (autossh, systemd units, sidecars). Ver [connecting-on-premise-databases.md §4](connecting-on-premise-databases.md).

3. **El soporte de engines está hardcodeado.** Agregar MongoDB o MSSQL requiere tocar lógica de backup, restore y test en múltiples lugares. Cada engine nuevo es un PR no-trivial.

El diseño propuesto resuelve los tres problemas con dos abstracciones: **`ConnectionDriver`** (por engine) y **`Transport`** (por estrategia de red). Son ortogonales — podés combinar Postgres con SSL con SSH tunneling sin escribir código combinatorio.

---

## 2. Arquitectura target

### 2.1 Layout de carpetas (propuesto)

```
apps/api/src/modules/connections/
├── drivers/
│   ├── connection-driver.interface.ts   ← contrato
│   ├── postgres.driver.ts
│   ├── mysql.driver.ts
│   ├── mongodb.driver.ts                ← futuro
│   └── mssql.driver.ts                  ← futuro
│
├── transport/
│   ├── transport.interface.ts            ← contrato
│   ├── direct.transport.ts               ← TCP pelado (lo de hoy)
│   ├── ssl.transport.ts                  ← TCP + handshake TLS
│   └── ssh-tunnel.transport.ts           ← TCP vía SSH local forwarding
│
├── connection.service.ts                 ← orquesta driver + transport
└── connection.factory.ts                 ← resuelve driver + transport desde la entity
```

### 2.2 El contrato `ConnectionDriver`

```ts
// drivers/connection-driver.interface.ts
export interface ConnectionDriver {
  readonly engine: 'postgres' | 'mysql' | 'mongodb' | 'mssql';

  /** Testea una conexión sin persistir. Devuelve latencia o error. */
  testConnection(opts: ConnectionOptions, transport: Transport): Promise<TestResult>;

  /** Stream de un dump hacia un writable stream. */
  dump(opts: ConnectionOptions, transport: Transport, out: NodeJS.WritableStream): Promise<DumpStats>;

  /** Restaura un dump desde un readable stream. */
  restore(opts: ConnectionOptions, transport: Transport, in_: NodeJS.ReadableStream): Promise<RestoreStats>;

  /** Lista las bases visibles para el usuario conectado. */
  listDatabases(opts: ConnectionOptions, transport: Transport): Promise<string[]>;

  /** Valida que el usuario tenga los privilegios mínimos requeridos. */
  validateCredentials(opts: ConnectionOptions, transport: Transport): Promise<PermissionReport>;
}
```

Cada driver es chico y focalizado — sin estado mutable compartido, fácil de unit-testear.

### 2.3 El contrato `Transport`

```ts
// transport/transport.interface.ts
export interface Transport {
  readonly kind: 'direct' | 'ssl' | 'ssh-tunnel';

  /** Resuelve el host/port efectivo al que el driver debe conectar. */
  resolve(opts: ConnectionOptions): Promise<{ host: string; port: number }>;

  /** Setea recursos (túnel, contexto TLS) antes de que el driver conecte. */
  setup(): Promise<void>;

  /** Limpia recursos después de que el driver desconecta. */
  teardown(): Promise<void>;

  /** Devuelve opciones driver-específicas (ej: config SSL de `pg`). */
  driverOptions(): Record<string, unknown>;
}
```

- **`DirectTransport`**: `resolve()` devuelve el host/port de la conexión tal cual. `setup/teardown` son no-ops.
- **`SslTransport`**: `resolve()` devuelve lo mismo, pero `driverOptions()` inyecta `{ ssl: { rejectUnauthorized: true, ca: <pem>, ... } }` en la config del driver.
- **`SshTunnelTransport`**: `setup()` abre una conexión SSH (usando `ssh2`) y un local port forward; `resolve()` devuelve `localhost:<puerto-local>`; `teardown()` cierra el túnel.

### 2.4 La capa de orquestación

```ts
// connection.service.ts (sketch)
async test(connection: ConnectionEntity): Promise<TestResult> {
  const driver = this.factory.driverFor(connection.engine);
  const transport = this.factory.transportFor(connection);

  await transport.setup();
  try {
    return await driver.testConnection(connection.toOptions(), transport);
  } finally {
    await transport.teardown();
  }
}
```

Ese es todo el cambio público. Los callers existentes de `connection.service.ts` no ven nada distinto.

---

## 3. Cambios al modelo de datos (propuesto)

La tabla `connections` gana tres columnas JSONB opcionales. Las filas existentes no se ven afectadas — columnas `NULL` significan "usar transport directo sin SSL", que matchea el comportamiento de hoy exactamente.

```sql
ALTER TABLE connections
  ADD COLUMN ssl_config JSONB NULL,
  ADD COLUMN ssh_tunnel_config JSONB NULL,
  ADD COLUMN network_options JSONB NULL;
```

### 3.1 Forma de `ssl_config`

```ts
type SslConfig = {
  mode: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  ca?: string;          // cifrado en reposo
  clientCert?: string;  // cifrado en reposo
  clientKey?: string;   // cifrado en reposo
};
```

### 3.2 Forma de `ssh_tunnel_config`

```ts
type SshTunnelConfig = {
  host: string;
  port: number;
  user: string;
  authMethod: 'password' | 'privateKey';
  credential: string;   // cifrado en reposo (password o PEM key)
  passphrase?: string;  // para keys cifradas
};
```

### 3.3 Forma de `network_options`

```ts
type NetworkOptions = {
  connectTimeoutMs: number;       // default 5000
  statementTimeoutMs: number;     // default 0 (sin límite)
  keepAlive: boolean;             // default true
};
```

### 3.4 Cifrado en reposo

Este es el **prerrequisito** para aterrizar el resto. El `connections.password` actual es plaintext hoy ([security-model.md §4](security-model.md)). Agregar más secretos (CA certs, SSH keys) sin cifrar primero amplifica la superficie de breach.

Approach propuesto: AES-256-GCM con una key derivada de una env var secreta (`ENVAULT_CREDENTIAL_KEY`). Pasos de migración:
1. Agregar columnas cifradas al lado de las plaintext (`password_encrypted`, etc.).
2. Backfill en el primer read/write de cada conexión.
3. Después que todas las filas estén migradas, dropear las columnas plaintext.

Esto es su propia change con su propio SDD — no bundlear con el refactor de drivers.

---

## 4. Roadmap (ordenado, con dependencias rough)

El orden importa. Cada paso construye sobre el anterior.

### Fase 1 — Foundation (sin cambios visibles al usuario)

| Item | Outcome | Por qué primero |
|------|---------|-----------------|
| Introducir interfaz `ConnectionDriver` | Extraer Postgres/MySQL en archivos de driver separados | Sin cambio de comportamiento, solo refactor |
| Introducir interfaz `Transport` con solo `DirectTransport` | Wrappear el comportamiento TCP directo actual | Igual que arriba — refactor, sin funcionalidad nueva |
| Agregar cifrado de credenciales en reposo | `password` está cifrado; UI/API sin cambios | Requerido antes de agregar más secretos |

### Fase 2 — Soporte de SSL

| Item | Outcome |
|------|---------|
| Implementar `SslTransport` | Postgres + SSL funciona end-to-end con `sslmode` |
| Agregar campos UI para config SSL | Usuarios pueden elegir mode y proveer certs |
| Migrar tabla `connections` para agregar columna `ssl_config` | Conexiones nuevas pueden usar SSL nativamente |
| Documentación: actualizar [connecting-cloud-databases.md](connecting-cloud-databases.md) | Neon, Supabase, RDS con SSL pasan de "bloqueado" a "soportado" |

### Fase 3 — SSH tunneling

| Item | Outcome |
|------|---------|
| Implementar `SshTunnelTransport` usando la librería `ssh2` | Los túneles se gestionan dentro de EnVault Management |
| Agregar campos UI para config SSH | Usuarios proveen bastion host, key, etc. |
| Agregar columna `ssh_tunnel_config` | Persiste config de túnel por conexión |
| Documentación: actualizar [connecting-on-premise-databases.md](connecting-on-premise-databases.md) | El patrón SSH tunnel pasa de "externo" a "nativo" |

### Fase 4 — Engines adicionales

| Item | Outcome |
|------|---------|
| Implementación de `MongoDriver` | EnVault Management backupea colecciones de MongoDB |
| Implementación de `MssqlDriver` | EnVault Management backupea bases de SQL Server |
| UI: el engine picker muestra los cuatro | Usuarios pueden registrar conexiones Mongo / MSSQL |
| Binarios `pg_dump` / `mysqldump` / `mongodump` / `sqlpackage` shippeados en el container de la API | Imagen base multi-binario |

### Fase 5 — Hardening operativo (independiente del trabajo de drivers)

| Item | Outcome |
|------|---------|
| Validación de allowlist por conexión | Rechazar `localhost`, direcciones link-local a menos que estén explícitamente permitidas |
| Reintentos con backoff exponencial | Errores transitorios de red no fallan los jobs |
| Endpoint `/metrics` (Prometheus) | Observabilidad más allá de stats del container |
| Logs estructurados JSON | Mejor integración con agregadores de logs |
| Scheduler con BullMQ + Redis | Scheduling multi-réplica sin jobs duplicados |

---

## 5. No-goals

Cosas explícitamente fuera del scope de este roadmap:

- **EnVault Management como SaaS multi-tenant.** EnVault Management es una herramienta self-hosteable. Tenancy/billing/SSO-por-tenant es otro producto distinto.
- **Reemplazar `pg_dump` / `mysqldump` con implementaciones custom del protocolo.** Las herramientas CLI nativas están battle-tested. Reinventarlas agrega riesgo sin beneficio.
- **Reemplazar TypeORM.** TypeORM está bien para la DB de control. La abstracción de drivers es para acceso a DBs gestionadas, no a la DB de control.
- **ETL genérico / movimiento de datos.** EnVault Management hace dump/restore, no migración selectiva de filas. Para eso existen herramientas como `pgloader` o Airbyte.

---

## 6. Cómo contribuir al roadmap

El roadmap está **priorizado pero no comprometido**. Si querés laburar en algo:

1. Abrí un issue en GitHub con el scope propuesto.
2. Esperá feedback del maintainer sobre si la prioridad/scope son correctos.
3. Si está alineado, el issue se vuelve la change proposal SDD (usando el workflow `/sdd-new` del proyecto).
4. La implementación sigue specs → design → tasks → apply → verify → archive.

Los refactors de drivers son **estructurales**: requieren migrations de conexiones existentes y cambios al flow de backup/restore. Tratalos como esfuerzos multi-PR, no parches one-shot.

---

## 7. Evaluación honesta para evaluadores

Si estás evaluando EnVault Management hoy y los gaps de §1 son deal-breakers (SSL especialmente), **sé honesto con vos mismo sobre tu timeline**. El roadmap es real pero el trabajo no está hecho. Dos opciones:

1. **Usar EnVault Management hoy para conexiones que no necesitan SSL/tunneling** (ej: conexiones same-VPC, ambientes dev/test).
2. **Esperar la Fase 2** si SSL es mandatorio para tu compliance.

Evitá la trampa de adoptar una herramienta porque el roadmap se ve bien — adoptala porque lo que existe hoy cumple tus necesidades, y el roadmap se alinea con dónde la querés ver.
