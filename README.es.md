# EnVault Management

> 🇬🇧 English version: [README.md](README.md)

**Datos reales de producción en desarrollo y QA, sin sobrescribir la base equivocada.**

Respaldos programados en su propio bucket de Cloudflare R2, simulación antes de restaurar y producción bloqueada como destino.

EnVault es una aplicación web autoalojada, con licencia [Fair Source](#licencia), para PostgreSQL y MySQL. Respalda sus bases de datos de producción en Cloudflare R2 y restaura esos volcados en sus bases de desarrollo y QA. Las conexiones etiquetadas como PROD se pueden respaldar, pero se rechazan como destino de una restauración.

![Servicios de EnVault: envault-web, envault-api, PostgreSQL, Redis y BullMQ](docs/assets/architecture-preview.png)

![Restauración de un respaldo de PROD en una base de DEV con EnVault: se eligen el volcado y el destino, se revisa la simulación previa, se escribe el nombre del destino para confirmar y se sigue la restauración hasta que termina](docs/assets/restore-flow.gif)

---

## Por qué EnVault

Cargar datos reales en desarrollo y QA debería ser una tarea rutinaria. En hosting de bajo costo, muchas veces no lo es:

- **Los respaldos de la plataforma no salen de la plataforma.** En Railway, por ejemplo, los respaldos de volúmenes requieren el plan Pro y [solo se pueden restaurar en el mismo proyecto y entorno](https://docs.railway.com/volumes/backups), así que no sirven para poblar una base de desarrollo con datos de producción.
- **La recuperación a un punto en el tiempo es costosa.** El [complemento PITR de Supabase](https://supabase.com/docs/guides/platform/backups) parte de unos 100 USD al mes, además del plan Pro.
- **Los accidentes ocurren.** Cargar un volcado sobre la base equivocada, o eliminar una base por error, es fácil cuando se ejecutan `pg_restore` o `mysql` a mano.

EnVault reúne en un solo lugar los volcados programados de producción y su carga en desarrollo y QA, con salvaguardas alrededor de producción.

> Los precios y límites de los planes se revisaron en octubre de 2026. Consulte la página de cada proveedor para conocer las condiciones vigentes.

---

## Qué hace hoy

### Respaldar producción

- Registre conexiones PostgreSQL y MySQL y etiquete cada una como **PROD**, **QA** o **DEV**. Pruebe una conexión antes de guardarla.
- Respalde conexiones PROD bajo demanda o con un horario: cada 1, 2, 3, 4, 6, 8 o 12 horas, a diario, semanal o mensualmente. Solo se pueden respaldar conexiones PROD.
- Los volcados (`pg_dump` en formato custom o `mysqldump`) se transmiten directamente a un bucket privado de Cloudflare R2 en fragmentos multipart de 32 MB, sin escribirse antes en el disco del servidor.
- La imagen de la API incluye las herramientas cliente de PostgreSQL de las versiones 14 a 18 y usa la que corresponde a cada servidor.
- Cada volcado registra un digest SHA-256 en su manifiesto de R2 y en su registro de trabajo.
- Siga el progreso en vivo, cancele un trabajo en curso y descargue un volcado mediante un enlace que vence a los 15 minutos.

### Llevar datos a desarrollo y QA

- Restaure cualquier volcado en una conexión QA o DEV del mismo motor.
- Ejecute primero una simulación opcional (dry run). Compara las tablas y la cantidad estimada de filas del volcado con las del destino, sin cambiar nada.
- Antes de tocar el destino, EnVault:
  - descarga el volcado a un área de staging, tras comprobar el espacio libre en disco;
  - compara el SHA-256 del volcado con el digest registrado, cuando existe uno;
  - rechaza las restauraciones que no pueden funcionar, como un volcado de PostgreSQL 17 en un servidor PostgreSQL 16.
- Las restauraciones de PostgreSQL se ejecutan como una sola transacción (`pg_restore --single-transaction`) después de una verificación estructural (`pg_restore -l`).
- Las restauraciones de MySQL se cargan primero en una base de datos sombra y luego intercambian las tablas con un único `RENAME TABLE`. Las vistas, triggers, rutinas y eventos se recrean justo después del intercambio, por lo que faltan durante un instante. Si el intercambio falla, se devuelven las tablas anteriores.
- Solo se ejecuta una restauración por destino a la vez.

### Mantener el almacenamiento bajo control

- Defina reglas de retención por conexión: conservar los últimos N volcados, eliminar los que tengan más de N días o limitar el tamaño total. El volcado más reciente siempre se conserva, y nunca se elimina un volcado que esté usando una restauración en curso.
- Revise una vista previa de cada limpieza antes de ejecutarla: qué volcados, por qué y cuánto espacio libera.
- Una limpieza elimina primero el volcado y su manifiesto de R2, y borra el registro de la base de datos solo cuando ambos ya no existen.
- Concilie R2 con la base de datos para encontrar registros cuyo volcado falta y archivos sin registro.
- Consulte el uso de almacenamiento por conexión y categoría.

### Ver qué ocurrió

- Un panel con la actividad diaria de respaldos, la tasa de éxito, las duraciones, el estado de las conexiones, el almacenamiento por conexión y el estado de las restauraciones.
- Un registro de auditoría de solo inserción (append-only) para las solicitudes a la API que modifican datos (exitosas o fallidas) y para los inicios de sesión, cierres de sesión y cambios de contraseña.
- Gestión de usuarios para administradores e interfaz web en inglés y español.

---

## Para quién es

- **Desarrolladores y freelancers** que operan varias aplicaciones en hosting de bajo costo, como Railway o un VPS, y quieren datos realistas en desarrollo y QA.
- **Agencias pequeñas** que quieren un solo lugar para ver los respaldos y restauraciones de todos sus clientes.
- **Equipos** cuyos respaldos de plataforma no pueden restaurar producción en otro entorno.

> Empresas, freelancers y agencias pueden usar EnVault, incluso en trabajos para clientes. Ofrecerlo como un producto o servicio comercial competidor, como un SaaS alojado, requiere permiso. Consulte [Licencia](#licencia).

---

## Cuándo usar otra herramienta

EnVault se enfoca en una tarea: llevar datos de producción a desarrollo y QA de forma segura. Genera volcados lógicos (`pg_dump`, `mysqldump`) y no ofrece recuperación a un punto en el tiempo.

| Si necesita | Considere |
| ----------- | --------- |
| Solo respaldos, sin copiar datos a desarrollo ni QA | Los respaldos nativos de su plataforma, o una herramienta general de respaldo como [Databasus](https://github.com/databasus/databasus) |
| Recuperación a un punto en el tiempo o respaldos físicos | [pgBackRest](https://pgbackrest.org) o [WAL-G](https://github.com/wal-g/wal-g) |

---

## Ejemplo de costos

El autor opera EnVault por unos **5 USD al mes**:

| Elemento | Configuración |
| -------- | ------------- |
| Hosting | Plan Hobby de Railway: 5 USD al mes, con 5 USD de uso incluidos |
| Almacenamiento | Capa gratuita de Cloudflare R2: 10 GB-mes de almacenamiento, 1 millón de operaciones Clase A al mes, egreso gratuito |
| Carga de trabajo | 2 bases de datos de producción, 48 volcados al día en total |

Es una configuración real, no una garantía. Su costo depende del tamaño de las bases, la frecuencia de los volcados, la retención y los precios vigentes de cada proveedor.

---

## Inicio rápido

### Requisitos

- **Para ejecutarlo:** Docker y Docker Compose, un bucket de Cloudflare R2 y un token de API de R2.
- **Para desarrollarlo:** Node.js 22 (22.23.4 o posterior) y pnpm 10.
- **Base de datos de control** (el estado propio de EnVault: conexiones, auditoría, horarios, metadatos de los volcados): PostgreSQL 16 o posterior. No se admiten otros motores, y la [configuración de TypeORM](apps/api/src/config/database.config.ts) es exclusiva de PostgreSQL. El stack de Compose la provee, junto con Redis 7.
- **Bases de datos que se respaldan:** PostgreSQL o MySQL. Consulte [conexión a bases de datos en la nube](docs/es/connecting-cloud-databases.md) y [conexión a bases de datos on-premise](docs/es/connecting-on-premise-databases.md).

### Configurar

```bash
git clone https://github.com/Aisaac2205/envault
cd envault
cp .env.example .env
```

Complete cada `<placeholder>` de `.env`: las credenciales de R2, `ENCRYPTION_KEY` (`openssl rand -hex 32`), `DB_PASSWORD`, `BETTER_AUTH_SECRET` y los datos del primer administrador, `BETTER_AUTH_ADMIN_EMAIL` y `BETTER_AUTH_ADMIN_PASSWORD`. Deje `VITE_API_URL` sin definir, salvo que la aplicación web y la API se ejecuten en orígenes distintos. Consulte [variables de entorno](docs/es/environment-variables.md) para la referencia completa.

### Ejecutar todo en Docker

```bash
docker compose up --build      # equivale a: pnpm docker:prod
```

Abra `http://localhost:5173` e inicie sesión con el correo y la contraseña de administrador definidos en `.env`.

### Ejecutarlo de forma nativa para desarrollo

Cambie el host de `DATABASE_URL` a `localhost` en `.env` y luego ejecute:

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis   # base de control + Redis
pnpm dev                                                                         # API :3000, web :5173
```

Para hot reload dentro de contenedores, use `pnpm docker:dev`, o `pnpm docker:dev:test` para levantar también las bases de prueba (PostgreSQL en `:5434`, MySQL en `:3306`). Más detalles en [desarrollo local](docs/es/local-development.md).

### Desplegar

| Camino | Ideal para | Guía |
| ------ | ---------- | ---- |
| PaaS (guía para Railway) | Un stack funcional en la nube en menos de una hora | [deployment-railway.md](docs/es/deployment-railway.md) |
| Autoalojado (Docker Compose, Kubernetes, Nomad, un VPS) | Redes on-premise, reguladas o privadas | [deployment-self-host.md](docs/es/deployment-self-host.md) |

---

## Seguridad en resumen

- **Las conexiones PROD están bloqueadas.** No se pueden editar desde la API, y ninguna conexión se puede reclasificar hacia o desde PROD. Eliminar una requiere su nombre exacto y la contraseña actual del administrador; tras 5 contraseñas incorrectas en 15 minutos, los intentos siguientes se rechazan durante un tiempo. Una eliminación solo borra el registro de EnVault y nunca toca la base de datos.
- **PROD se rechaza como destino de restauración** al solicitar la restauración, al admitirla en la cola y otra vez en el worker, justo antes de escribir.
- **EnVault confía en la etiqueta.** Todavía no detecta una conexión DEV o QA que apunte al mismo servidor y base de datos que una PROD. Una verificación del destino físico está en la [hoja de ruta](#hoja-de-ruta).
- **La integridad del volcado se verifica cuando es posible.** El SHA-256 de cada volcado se compara al restaurar. Si ni el registro del trabajo ni el manifiesto tienen un digest, la restauración hoy se ejecuta sin esa comparación.
- **Las credenciales se cifran en reposo** con AES-256-GCM y la API nunca las devuelve.
- **El acceso se deniega por defecto.** Las sesiones por cookie (`httpOnly`) se validan contra la base de datos en cada solicitud, y un único mapa de permisos aplicado por la API decide quién puede usar qué. Las contraseñas nuevas requieren al menos 12 caracteres y se rechazan si son comunes o triviales.
- **El registro de auditoría es de solo inserción.** Triggers de la base de datos bloquean `UPDATE`, `DELETE` y `TRUNCATE` sobre él. Las acciones de gestión de usuarios y las ejecuciones programadas todavía no quedan en él; las ejecuciones programadas se rastrean en el historial de trabajos.
- **Los volcados son privados.** El bucket es privado y las descargas usan enlaces prefirmados que vencen a los 15 minutos.

Detalles completos, con referencias al código: [modelo de seguridad](docs/es/security-model.md).

---

## Hoja de ruta

- **Restauraciones más seguras:** una verificación de que el destino no sea físicamente la base PROD, proyectos para agrupar conexiones, simulación obligatoria, una instantánea del destino antes de cada restauración con opción de deshacer, simulacros de restauración programados y rechazo de la restauración cuando no hay digest disponible.
- **Configuración de cuenta** con autenticación de dos factores y passkeys.
- Soporte para **MariaDB**.
- **Volcados cifrados.**
- **Recuperación de cuenta** por correo electrónico.
- **Mejor visibilidad del entorno**, para que siempre quede claro en qué entorno se está trabajando.

---

## Para colaboradores

### Stack

| Capa                | Tecnología                                     | Versión  |
| ------------------- | ---------------------------------------------- | -------- |
| Runtime             | Node.js                                        | 22 (≥ 22.23.4) |
| Gestor de paquetes  | pnpm workspaces                                | ≥ 10     |
| Lenguaje            | TypeScript                                     | ^5.9.3   |
| Backend             | NestJS                                         | ^11.2.8  |
| ORM                 | TypeORM                                        | ^0.3.31  |
| Frontend            | React                                          | ^19.3.1  |
| Build tool          | Vite                                           | ^7.3.7   |
| Router              | React Router                                   | ^7.18.4  |
| Autenticación       | Better Auth (dentro de la API, sesiones por cookie) | 1.7.14 |
| Almacenamiento      | Cloudflare R2 (compatible con S3)              | -        |
| Base de control     | PostgreSQL 16+ (obligatorio)                   | -        |
| Colas y tareas      | Redis 7 + BullMQ                               | ^6.3.16  |
| Tiempo real         | Server-Sent Events (SSE)                       | -        |

### Estructura del monorepo

```
envault/
├── apps/
│   ├── api/                   # NestJS, monolito modular          :3000
│   ├── web/                   # React + Vite, vertical slices     :5173 (dev) / :80 (contenedor)
│   └── landing/               # Sitio de marketing (propietario, ver Licencia)
├── e2e/                       # Suite end-to-end con Playwright
├── scripts/                   # Scripts de simulacro de restauración y verificación de seguridad
├── docs/
│   ├── assets/                # Imágenes de la documentación
│   ├── en/                    # Documentación técnica (inglés)
│   └── es/                    # Documentación técnica (español)
├── docker-compose.yml         # Stack similar a producción
├── docker-compose.dev.yml     # Overrides de desarrollo (hot reload, perfil 'test' opcional)
├── docker-compose.e2e.yml     # Overrides del stack E2E
├── .env.example               # Plantilla: copiar a .env (nunca versionar .env)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

El monorepo usa **pnpm workspaces** sin Turborepo ni Nx. Workspaces: `apps/*` y `e2e`.

### Scripts

| Comando                | Descripción                                               |
| ---------------------- | --------------------------------------------------------- |
| `pnpm dev`             | API + web en modo watch/hot reload (Node.js nativo)       |
| `pnpm build`           | Compila todas las apps para producción                    |
| `pnpm test`            | Pruebas unitarias de todos los workspaces                 |
| `pnpm test:coverage`   | Pruebas unitarias con cobertura                           |
| `pnpm test:e2e`        | Suite end-to-end con Playwright                           |
| `pnpm lint`            | Linting en todos los workspaces                           |
| `pnpm typecheck`       | Verificación de tipos sin emitir archivos                 |
| `pnpm docker:dev`      | Stack completo en Docker con hot reload                   |
| `pnpm docker:dev:test` | Lo mismo, más las bases de prueba (PostgreSQL :5434, MySQL :3306) |
| `pnpm docker:db`       | Solo la base de control (PostgreSQL, sin Redis)           |
| `pnpm docker:db:test`  | La base de control más las bases de prueba                |
| `pnpm docker:prod`     | Build de producción end-to-end                            |

Por workspace:

```bash
pnpm --filter @vaultly-control/api dev
pnpm --filter @vaultly-control/web build
```

### Enlaces rápidos para DevOps

| Lo que necesita                                         | Dónde consultar                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ejecutar localmente desde cero                          | [docs/es/local-development.md](docs/es/local-development.md)                             |
| Desplegar en Railway (camino PaaS rápido)               | [docs/es/deployment-railway.md](docs/es/deployment-railway.md)                           |
| Desplegar en su propia infraestructura (K8s, Nomad, Docker, etc.) | [docs/es/deployment-self-host.md](docs/es/deployment-self-host.md)             |
| Conectar bases gestionadas en la nube (Neon / RDS / Azure) | [docs/es/connecting-cloud-databases.md](docs/es/connecting-cloud-databases.md)        |
| Conectar bases on-premise (túneles SSH, VPN)            | [docs/es/connecting-on-premise-databases.md](docs/es/connecting-on-premise-databases.md) |
| Operación diaria / runbook                              | [docs/es/devops-runbook.md](docs/es/devops-runbook.md)                                   |
| Reconstruir tras un desastre                            | [docs/es/disaster-recovery.md](docs/es/disaster-recovery.md)                             |
| Solución de problemas                                   | [docs/es/troubleshooting.md](docs/es/troubleshooting.md)                                 |
| Hacia dónde va el proyecto (driver+transport)           | [docs/es/architecture-roadmap.md](docs/es/architecture-roadmap.md)                       |

> Los documentos marcados con `STATUS: PROPOSED` describen la arquitectura objetivo, no el comportamiento actual. Contrástelos con el código fuente antes de actuar según ellos.

### Documentación

#### Primeros pasos

| Doc                                                        | Contenido                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [local-development.md](docs/es/local-development.md)       | Configuración local: Node.js vs Docker, comandos, depuración    |
| [deployment-railway.md](docs/es/deployment-railway.md)     | Guía de Railway: servicios, variables, configuración de entorno |
| [deployment-self-host.md](docs/es/deployment-self-host.md) | Contrato de despliegue independiente de la plataforma para K8s/Nomad/etc. |

#### Cómo funciona (dominio)

| Doc                                                                | Contenido                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| [flow-database-management.md](docs/es/flow-database-management.md) | Conexiones: entornos, permisos por motor, ciclo de vida         |
| [scheduler-architecture.md](docs/es/scheduler-architecture.md)     | Cronjobs, SchedulerRegistry, compromiso de una sola réplica     |
| [security-model.md](docs/es/security-model.md)                     | Invariantes de PROD, auditoría, autorización (con referencias al código) |

#### Operaciones (DevOps)

| Doc                                                                              | Contenido                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [connecting-cloud-databases.md](docs/es/connecting-cloud-databases.md)           | Configuración de bases gestionadas: Neon, RDS, Supabase, Azure, GCP |
| [connecting-on-premise-databases.md](docs/es/connecting-on-premise-databases.md) | Patrones on-premise: autoalojado, VPN, túnel SSH           |
| [devops-runbook.md](docs/es/devops-runbook.md)                                   | Lista de verificación previa a producción, monitoreo, rotaciones, incidentes |
| [disaster-recovery.md](docs/es/disaster-recovery.md)                             | Reconstrucción en frío, escenarios de recuperación, simulacros |
| [troubleshooting.md](docs/es/troubleshooting.md)                                 | Índice síntoma → causa → solución                          |

#### Arquitectura técnica

| Doc                                                        | Contenido                                           |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [architecture.md](docs/es/architecture.md)                 | Módulos de la API, estructura web, SSE              |
| [infrastructure.md](docs/es/infrastructure.md)             | Docker Compose local, credenciales de prueba        |
| [architecture-roadmap.md](docs/es/architecture-roadmap.md) | Diseño propuesto driver+transport (NO implementado) |

#### Referencia

| Doc                                                          | Contenido                                     |
| ------------------------------------------------------------ | --------------------------------------------- |
| [environment-variables.md](docs/es/environment-variables.md) | Todas las variables con tipos y valores por defecto |
| [database-migrations.md](docs/es/database-migrations.md)     | Migraciones de TypeORM: generate, run, revert |
| [e2e-testing.md](docs/es/e2e-testing.md)                     | Suite end-to-end con Playwright               |
| [testing-coverage.md](docs/es/testing-coverage.md)           | Cobertura de las pruebas unitarias            |
| [conventions.md](docs/es/conventions.md)                     | Nombres, imports, commits, TypeScript         |

---

## Licencia

- **Plataforma principal (`apps/api`, `apps/web`, `e2e` y el workspace raíz)**: licenciada bajo la [Functional Source License 1.1, Apache 2.0 Future License (FSL-1.1-ALv2)](LICENSE.md), una licencia Fair Source. Puede usarla, modificarla y autoalojarla, incluso dentro de una empresa y en trabajos para clientes. No puede ofrecerla, ni ofrecer un producto o servicio sustancialmente similar, a terceros como producto o servicio comercial (por ejemplo, un SaaS alojado) sin permiso. Cada versión queda disponible bajo la Apache License 2.0 dos años después de su publicación.
- **Landing page y marca (`apps/landing`, nombre y logos de EnVault)**: **Todos los derechos reservados**. Código propietario exclusivo; queda prohibida su copia, clonación o publicación en hosting público. Ver [`apps/landing/LICENSE.md`](apps/landing/LICENSE.md).
