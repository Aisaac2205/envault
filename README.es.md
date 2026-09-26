# EnVault Management

> 🇬🇧 English version: [README.md](README.md)

Plataforma de gestión centralizada de bases de datos. Permite administrar conexiones, ejecutar y programar backups, restaurar copias de seguridad, auditar operaciones y monitorear jobs en múltiples entornos desde una única interfaz web.

---

## Stack

| Capa            | Tecnología                    | Versión |
| --------------- | ----------------------------- | ------- |
| Runtime         | Node.js                       | ≥ 22    |
| Package manager | pnpm workspaces               | ≥ 9     |
| Lenguaje        | TypeScript                    | ^5.8.3  |
| Backend         | NestJS                        | ^11.0.7 |
| ORM             | TypeORM                       | ^0.3.20 |
| Frontend        | React                         | ^19.1.0 |
| Build tool      | Vite                          | ^6.3.3  |
| Router          | React Router                  | ^7.5.0  |
| Auth            | Better Auth (nativo, sesiones por cookie) | -  |
| Storage         | Cloudflare R2 (S3-compatible) | -       |
| Base de datos   | PostgreSQL 16                 | -       |
| Colas y tareas  | Redis 7 + BullMQ (^11.0.3)    | -       |
| Tiempo real     | Server-Sent Events (SSE)      | -       |

---

## Integridad de Datos y Respaldos Verificables

EnVault Management implementa invariantes estrictos de integridad de datos para erradicar la corrupción silenciosa de volcados, restauraciones parciales y pérdidas irreversibles:

1. **Digest Criptográfico al Vuelo**
   Cada volcado en streaming (`pg_dump` o `mysqldump`) calcula un hash SHA-256 al vuelo sin buffering en memoria. El digest se registra en la base de datos de control y en el archivo manifiesto versión 2 en Cloudflare R2 (`*.manifest.json`).
2. **Verificación Criptográfica Previa al Restore**
   Antes de escribir datos en el motor destino, EnVault descarga el archivo en staging, calcula su hash SHA-256 y lo compara contra el digest registrado usando `crypto.timingSafeEqual` (previniendo ataques de temporización y sustitución).
3. **Preflight Estructural (`pg_restore -l`)**
   Se valida la tabla de contenidos (TOC) y cabecera antes de abrir conexiones con el motor destino. Volcados truncados o corruptos abortan de inmediato.
4. **Restauraciones Transaccionales Atómicas**
   En PostgreSQL se aplica `--single-transaction` para rollback total ante cualquier fallo. En MySQL se utiliza una restauración en 4 fases sobre base de datos sombra (*shadow swap*).
5. **Recuperación ante Desastres en Frío**
   Runbook oficial de reconstrucción desde cero y simulacros periódicos en sandbox. Consulte [docs/es/disaster-recovery.md](docs/es/disaster-recovery.md).
6. **Depuración Coordinada en Dos Etapas**
   El proceso de purga opera en dos etapas coordinadas para garantizar que no permanezcan archivos huérfanos en la nube ni registros inconsistentes en la base de control. En primer lugar, se emite la orden de eliminación física hacia el bucket de almacenamiento de objetos, y una vez confirmada la supresión del archivo remoto, se purga el registro correspondiente en la base de datos de control.
7. **Simulación Previa sin Impacto Destructivo**
   Para validar el alcance de las políticas de retención antes de aplicar cambios irreversibles, EnVault permite ejecutar limpiezas en modo de simulación. Esta operación computa las reglas configuradas y reporta la relación exacta de copias candidatas a eliminación, sus identificadores y el volumen total de almacenamiento en bytes que se liberará, sin suprimir ningún dato del almacenamiento de objetos.

---

## Arquitectura de Procesamiento Asíncrono con Redis y BullMQ

EnVault desacopla todas las operaciones pesadas de copias de seguridad y restauraciones mediante colas administradas por BullMQ y respaldadas por Redis 7.

1. **Desacople HTTP con Respuesta 202 Accepted**
   Las peticiones de creación de copias manuales o programadas no bloquean el ciclo de vida del servidor web. La API valida la conexión, registra el trabajo en estado PENDING, encola la tarea en Redis y responde inmediatamente con código HTTP 202 Accepted y el identificador del trabajo para seguimiento en vivo.

2. **Control Estricto de Concurrencia por Conexión**
   Para proteger la estabilidad operativa de los motores de bases de datos administrados, el sistema rechaza la ejecución simultánea de múltiples operaciones sobre una misma base de datos con un error HTTP 409 Conflict. Los workers de BullMQ procesan tareas en paralelo con un límite estricto de concurrencia de dos trabajos simultáneos por instancia.

3. **Canalización Multipart Hacia Cloudflare R2**
   La transferencia de las copias hacia el almacenamiento de objetos opera mediante streaming directo sin escribir archivos intermedios en el disco del contenedor. El cargador multipart divide el flujo en fragmentos de 32 MB con una cola interna de cuatro partes concurrentes. Este mecanismo mantiene el uso de memoria RAM por debajo de 128 MB y permite respaldar bases de datos de hasta 320 GB.

4. **Prevención de Partes Huérfanas y Contrapresión**
   El transformador de flujo regula la velocidad de lectura del motor de origen para evitar saturar los buffers de Node.js. Si ocurre un error de red o el usuario cancela la tarea, el sistema emite una orden de anulación inmediata en la API de Cloudflare R2 y elimina todas las partes cargadas hasta el momento para evitar costos por almacenamiento residual.

5. **Preparación para Colas Asíncronas de Restauración**
   Esta misma infraestructura de colas gobierna el flujo de recuperación de desastres. Cada restauración encola una tarea aislada que valida previamente el espacio en disco disponible en el directorio de staging y ejecuta verificaciones de integridad antes de iniciar la escritura en la base de datos de destino.

6. **Depuración Coordinada en Dos Etapas y Simulación Previa**
   Las políticas de retención y limpiezas manuales operan en dos fases secuenciales. Primero se suprime físicamente la copia y su archivo de manifiesto en Cloudflare R2, y únicamente tras confirmar dicha supresión se purga el registro de la base de control. Adicionalmente, el modo de simulación previa computa las copias candidatas, los bytes exactos a liberar y los motivos antes de realizar alteraciones definitivas.

7. **Capacidad de Almacenamiento y Capa Gratuita de Cloudflare R2**
   Cloudflare R2 incluye una capa gratuita permanente de diez gigabytes mensuales sin costos por transferencia saliente hacia internet, lo que permite operar EnVault a costo cero para entornos medianos. El límite por archivo alcanza cinco terabytes, y la división en partes de 32 MB permite transferir copias de hasta 320 GB dentro del límite de diez mil partes del protocolo S3.

---

## Arquitectura y Referencia Visual

EnVault Management corre en cualquier plataforma que pueda hostear contenedores Docker, Redis 7 y una instancia de PostgreSQL 16+ (PaaS en la nube, servidores on-prem, clusters air-gapped, o una workstation local).

![Vista general de la arquitectura](docs/assets/architecture-preview.png)

| Camino de deploy | Ideal para | Guía |
|------------------|------------|------|
| **PaaS push-deploy** (Railway, Fly.io, Render) | Setup cloud rápido, stack funcional en menos de una hora | [deployment-railway.md](docs/es/deployment-railway.md) |
| **Self-host / GitOps** (Docker Compose, Kubernetes + ArgoCD) | On-prem, regulado, air-gapped, o redes privadas | [deployment-self-host.md](docs/es/deployment-self-host.md) |


---

## Estructura del monorepo

```
vaultly-control/
│
├── apps/
│   ├── api/                     # NestJS — Monolito Modular  :3000
│   └── web/                     # React + Vite — Vertical Slice  :5173 / :80
│
├── docs/
│   ├── en/                      # Documentación técnica (inglés)
│   └── es/                      # Versión en español
│
├── docker-compose.yml      # Stack en Docker (para CI o servers self-hosted)
├── docker-compose.dev.yml  # Overrides dev (hot reload, perfil 'test' opcional)
│
├── .env                    # Variables activas (no commitear)
├── .env.example            # Plantilla — copiar a .env
│
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

El monorepo usa **pnpm workspaces** sin Turborepo ni Nx. Workspace activo: `apps/*`.

---

## Primeros pasos

### Prerrequisitos

- Node.js ≥ 22
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker + Docker Compose

### Instalación

```bash
git clone https://github.com/Aisaac2205/envault
cd envault
pnpm install
```

### Configuración de entorno

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Editar ambos con los valores reales
```

Ver [docs/es/environment-variables.md](docs/es/environment-variables.md) para referencia completa.

> **Better Auth** corre dentro de la API. Setear `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_ADMIN_EMAIL` y `BETTER_AUTH_ADMIN_PASSWORD` en `apps/api/.env`.

### Levantar la DB local

```bash
pnpm docker:db
```

### Arrancar en modo desarrollo

```bash
pnpm dev
```

API disponible en `http://localhost:3000` · Frontend en `http://localhost:5173`.

### Levantar todo en Docker

```bash
pnpm docker:dev          # api + web + db con hot reload
pnpm docker:dev:test     # idem + db-test-pg (:5434) + db-test-mysql (:3306)
pnpm docker:prod         # build de producción end-to-end
```

---

## Scripts

| Comando                | Descripción                                           |
| ---------------------- | ----------------------------------------------------- |
| `pnpm dev`             | API + Web en modo watch/hot-reload (Node.js nativo)   |
| `pnpm build`           | Compila todas las apps para producción                |
| `pnpm test`            | Tests de todos los workspaces                         |
| `pnpm lint`            | Linting en todos los workspaces                       |
| `pnpm typecheck`       | Verificación de tipos sin emitir archivos             |
| `pnpm docker:dev`      | Stack completo en Docker con hot reload               |
| `pnpm docker:dev:test` | Idem + DBs de testing (PostgreSQL :5434, MySQL :3306) |
| `pnpm docker:db`       | Solo la DB principal (para correr api/web nativos)    |
| `pnpm docker:prod`     | Build de producción end-to-end                        |

Por workspace:

```bash
pnpm --filter @vaultly-control/api dev
pnpm --filter @vaultly-control/web build
```

---

## Documentación

### Para DevOps — links rápidos

| Lo que necesitás                                  | Dónde mirar                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Correr localmente desde cero                      | [docs/es/local-development.md](docs/es/local-development.md)                           |
| Deployar a Railway (camino PaaS rápido)                         | [docs/es/deployment-railway.md](docs/es/deployment-railway.md)                   |
| Deployar a tu propia infra (K8s, Nomad, Docker, etc.) | [docs/es/deployment-self-host.md](docs/es/deployment-self-host.md)                 |
| Conectar a DBs cloud gestionadas (Neon / RDS)     | [docs/es/connecting-cloud-databases.md](docs/es/connecting-cloud-databases.md)         |
| Conectar a DBs on-premise (SSH tunnels, VPN)      | [docs/es/connecting-on-premise-databases.md](docs/es/connecting-on-premise-databases.md) |
| Operación día a día / runbook                     | [docs/es/devops-runbook.md](docs/es/devops-runbook.md)                                 |
| Troubleshooting                                   | [docs/es/troubleshooting.md](docs/es/troubleshooting.md)                               |
| Hacia dónde va el proyecto (driver+transport)     | [docs/es/architecture-roadmap.md](docs/es/architecture-roadmap.md)                     |

### Empezar

| Doc                                                    | Contenido                                                 |
| ------------------------------------------------------ | --------------------------------------------------------- |
| [local-development.md](docs/es/local-development.md)       | Setup local: Node.js vs Docker, comandos, debugging              |
| [deployment-railway.md](docs/es/deployment-railway.md)     | Walkthrough Railway: services, variables, setup de entorno       |
| [deployment-self-host.md](docs/es/deployment-self-host.md) | Contrato de deployment plataforma-agnóstico para K8s/Nomad/etc.  |

### Cómo funciona (dominio)

| Doc                                                                | Contenido                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [flow-database-management.md](docs/es/flow-database-management.md) | Connections: environments, permisos por engine, ciclo de vida |
| [scheduler-architecture.md](docs/es/scheduler-architecture.md)     | Cronjobs, SchedulerRegistry, single-replica                   |
| [security-model.md](docs/es/security-model.md)                     | Invariantes de PROD, audit, autorización (con refs a código)  |

### Operaciones (DevOps)

| Doc                                                                                      | Contenido                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [connecting-cloud-databases.md](docs/es/connecting-cloud-databases.md)                   | Setup de DBs gestionadas: Neon, RDS, Supabase, Azure, GCP   |
| [connecting-on-premise-databases.md](docs/es/connecting-on-premise-databases.md)         | Patrones on-prem: self-host, VPN, túnel SSH                 |
| [devops-runbook.md](docs/es/devops-runbook.md)                                           | Checklist pre-prod, monitoreo, rotaciones, incidentes       |
| [troubleshooting.md](docs/es/troubleshooting.md)                                         | Índice síntoma → causa → fix                                |

### Arquitectura técnica

| Doc                                                          | Contenido                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| [architecture.md](docs/es/architecture.md)                   | Módulos API, estructura web, SSE                          |
| [infrastructure.md](docs/es/infrastructure.md)               | Docker Compose local, credenciales de testing             |
| [architecture-roadmap.md](docs/es/architecture-roadmap.md)   | Diseño propuesto driver+transport (NO implementado)       |

### Referencia

| Doc                                                          | Contenido                                 |
| ------------------------------------------------------------ | ----------------------------------------- |
| [environment-variables.md](docs/es/environment-variables.md) | Todas las variables con tipos y defaults  |
| [database-migrations.md](docs/es/database-migrations.md)     | TypeORM migrations: generate, run, revert |
| [conventions.md](docs/es/conventions.md)                     | Nombrado, imports, commits, TypeScript    |

---

## Licencia

* **Plataforma Core (`apps/api`, `apps/web`)**: Licenciada bajo la [PolyForm Noncommercial License 1.0.0](LICENSE.md) — libre para usar y self-hostear con fines personales o no comerciales. El uso comercial, reventa o distribución requiere una licencia comercial separada del titular del copyright.
* **Landing Page y Marca (`apps/landing`, nombre/logos EnVault)**: **Todos los Derechos Reservados**. Código propietario exclusivo; queda prohibida su copia, clonación o despliegue/hosting público. Ver [`apps/landing/LICENSE.md`](apps/landing/LICENSE.md).
