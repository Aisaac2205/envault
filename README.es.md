# EnVault Management

> 🇬🇧 English version: [README.md](README.md)

Plataforma de gestión centralizada de bases de datos. Permite administrar conexiones, ejecutar y programar backups, restaurar dumps, auditar operaciones y monitorear jobs en múltiples entornos desde una única interfaz web.

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
| Auth            | Better Auth (nativo, sesiones por cookie) | —  |
| Storage         | Cloudflare R2 (S3-compatible) | —       |
| Base de datos   | PostgreSQL 16                 | —       |
| Tiempo real     | Server-Sent Events (SSE)      | —       |

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

---

## Arquitectura — referencia visual

EnVault Management corre en cualquier plataforma que pueda hostear contenedores Docker y una instancia de PostgreSQL 16+ — PaaS en la nube, servidores on-prem, clusters air-gapped, o una workstation local.

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
