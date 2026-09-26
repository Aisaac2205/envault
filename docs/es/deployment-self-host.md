# Contrato de Deploy Self-Host

> 🇬🇧 English version: [../en/deployment-self-host.md](../en/deployment-self-host.md)

Este es el **contrato de deploy plataforma-agnóstico** de EnVault Management. Te dice exactamente qué necesita la app para correr, sin importar dónde la corras (Kubernetes, Nomad, Docker Swarm, ECS, `docker run` en un VPS, etc.).

**Este doc NO incluye**:
- Manifests de Kubernetes, Helm charts, o bases de Kustomize (escribilos vos desde el contrato de abajo)
- Instrucciones específicas de ArgoCD / Flux / Jenkins X / Spinnaker / Tekton
- Pegamento específico de cloud provider (usá este junto con [connecting-cloud-databases.md](connecting-cloud-databases.md))

Si querés un template de PaaS gestionada, usá [deployment-railway.md](deployment-railway.md).

---

## 1. Las dos imágenes

EnVault Management se distribuye como dos imágenes Docker:

| Imagen | Built desde | Propósito | Escucha en |
|--------|-------------|-----------|------------|
| API | [`apps/api/Dockerfile`](../../apps/api/Dockerfile) | Backend NestJS, corre migrations, sirve REST + SSE | `3000` (HTTP) |
| Web | [`apps/web/Dockerfile`](../../apps/web/Dockerfile) | nginx sirviendo el SPA React buildeado | `80` (HTTP) |

Buildealas vos desde el repo, o pulleá desde tu registry cuando tu CI las publique.

```bash
# Build local desde la raíz del monorepo
docker build -t envault-api:local -f apps/api/Dockerfile .
docker build -t envault-web:local -f apps/web/Dockerfile .
```

Ambos Dockerfiles esperan la raíz del monorepo como contexto de build porque leen `pnpm-workspace.yaml` y `pnpm-lock.yaml`.

### Despliegue Individual de Contenedores

Si prefiere desplegar la API, el Web y los servicios base en servidores o procesos separados sin orquestador:

```bash
# 1. Contenedor de Redis (con persistencia AOF y contraseña obligatoria)
docker run -d \
  --name envault-redis \
  --restart unless-stopped \
  -v redis_data:/data \
  redis:7-alpine redis-server --appendonly yes --maxmemory-policy noeviction --requirepass "tu-clave-segura"

# 2. Contenedor de la API (en el host de backend)
docker run -d \
  --name envault-api \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env.api \
  envault-api:local

# 3. Contenedor Web (en el host de frontend)
docker run -d \
  --name envault-web \
  --restart unless-stopped \
  -p 80:80 \
  -e API_UPSTREAM=api.interno.corp:3000 \
  -e CSP_HEADER_NAME=Content-Security-Policy \
  envault-web:local
```

`--maxmemory-policy noeviction` es necesario para que Redis rechace escrituras en lugar de descartar silenciosamente claves de las colas de BullMQ bajo presión de memoria (ver [BullMQ: going to production](https://docs.bullmq.io/guide/going-to-production)). Una instancia de Redis administrada (por ejemplo, en Railway) se aprovisiona fuera de `docker-compose.yml`, por lo que esta política debe configurarse desde la propia consola de ese proveedor.

---

## 2. Variables de entorno: el contrato

Referencia completa en [environment-variables.md](environment-variables.md). La tabla siguiente especifica el contrato obligatorio para arrancar.

### API (runtime)

| Variable | Requerida | Notas |
|---|---|---|
| `DATABASE_URL` | sí | Cadena de conexión PostgreSQL 16+ para la base de control |
| `ENCRYPTION_KEY` | sí | Clave hexadecimal de 64 caracteres (32 bytes) para cifrar credenciales con AES-256-GCM |
| `NODE_ENV` | sí | `production` en cualquier entorno productivo |
| `PORT` | no (default `3000`) | Puerto TCP de escucha HTTP |
| `CORS_ORIGIN` | sí en producción | Dominio exacto del frontend, sin comodines ni wildcards |
| `BETTER_AUTH_SECRET` | sí | Clave secreta para firmar sesiones (mínimo 32 caracteres aleatorios) |
| `BETTER_AUTH_URL` | sí | URL pública base de la API |
| `BETTER_AUTH_ADMIN_EMAIL` | sí | Correo electrónico del usuario administrador inicial |
| `BETTER_AUTH_ADMIN_PASSWORD` | sí | Contraseña inicial del usuario administrador |
| `REDIS_HOST` | condicional | Host de Redis (ejemplo: `redis` en Docker Compose o `localhost`). Alternativamente use `REDIS_URL` |
| `REDIS_PORT` | no (default `6379`) | Puerto TCP de conexión a Redis |
| `REDIS_PASSWORD` | sí en producción | Contraseña para autenticar con Redis mediante comando requirepass |
| `REDIS_URL` | opcional | URL completa de Redis (`redis://...` o `rediss://...`). Prioritaria si está definida |
| `REDIS_TLS` | no (default `false`) | Habilita TLS si conecta hacia un clúster Redis gestionado externo |
| `R2_ACCOUNT_ID` | sí en producción | Identificador de cuenta Cloudflare (hexadecimal de 32 caracteres) |
| `R2_ACCESS_KEY_ID` | sí en producción | Clave de acceso generada en R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` | sí en producción | Clave secreta generada en R2 API Tokens |
| `R2_BUCKET_NAME` | sí en producción | Nombre del bucket R2 destinado a los respaldos |
| `BACKUP_TIMEOUT_MS` | no (default `1800000`) | Límite máximo en milisegundos para operaciones de dump (30 minutos) |
| `RESTORE_TIMEOUT_MS` | no (default `1800000`) | Límite máximo en milisegundos para operaciones de restauración |

### Web (build-time Y runtime)

La capa Web es **GitOps-friendly por diseño**: lee la config runtime de `window.APP_CONFIG`, que `entrypoint.sh` genera al arrancar el container desde variables de entorno. **No va `.env` en la imagen.**

| Variable | Requerida | Notas |
|----------|-----------|-------|
| `VITE_API_URL` | sí | URL del backend (ej: `https://api.example.com`) |
| `VITE_APP_BASE_URL` | sí | URL pública del web (ej: `https://app.example.com`) |

> El prefijo `VITE_` es histórico (eran vars de build-time de Vite). En runtime se leen con los mismos nombres como env vars del container desde `entrypoint.sh`. No hace falta rebuildear la imagen para cambiarlas — solo reiniciá el container con valores nuevos.

> Auth está manejado completamente por la API vía Better Auth. El Web no necesita variables de entorno específicas para auth — las sesiones son por cookie y el browser las maneja automáticamente.

---

## 3. Health endpoints y probes

| Endpoint | Path | Auth | Devuelve |
|----------|------|------|----------|
| Liveness/readiness de la API | `GET /health` | Ninguna (pública) | `200` si está saludable |
| Liveness del Web | `GET /` | Ninguna | `200` (nginx sirve index.html) |

### Configuración recomendada de probes

| Probe | API | Web |
|-------|-----|-----|
| Path de liveness | `/health` | `/` |
| Path de readiness | `/health` | `/` |
| Delay inicial | 15s (dejar correr las migrations) | 5s |
| Período | 10s | 10s |
| Timeout | 3s | 2s |
| Failure threshold | 3 | 3 |

El **delay inicial de 15 segundos en la API** es importante: en el primer boot, TypeORM corre migrations contra la DB de control antes que el server HTTP esté totalmente listo. Si el probe corre demasiado pronto, el pod muere antes que terminen las migrations.

---

## 4. Sizing de recursos

Números honestos como baseline. **Validalos con tu workload** — son puntos de partida, no compromisos.

| Container | Request CPU | Limit CPU | Request memoria | Limit memoria |
|-----------|-------------|-----------|-----------------|----------------|
| API | 100m | 500m | 256 MiB | 512 MiB |
| Web (nginx) | 25m | 100m | 32 MiB | 128 MiB |
| DB de control (Postgres 16) | 250m | 1000m | 512 MiB | 2 GiB |
| Redis (BullMQ) | 50m | 200m | 64 MiB | 256 MiB |

**Drivers de escalado**:
- La memoria de la API crece con el **tamaño del dump durante el streaming**. `pg_dump` de una DB de 50GB no la carga toda en memoria (es streaming), pero partes del multipart upload a R2 hacen buffering. Si backupeás DBs grandes (>20GB), subí la memoria de la API a 1 GiB.
- La CPU de la API tiene spikes durante compresión de dump y restore. Spikes breves está bien; presión sostenida significa que estás cortito.
- El Web es esencialmente gratis (nginx sirviendo archivos estáticos). Si tenés miles de usuarios concurrentes es otra conversación, pero para una herramienta interna de DevOps los defaults sobran.

---

## 5. Storage

| Container | ¿Necesita volumen persistente? | Por qué |
|-----------|--------------------------------|---------|
| API | **No** | Stateless. Los dumps van por stream a R2, nada queda en disco local. |
| Web | **No** | Stateless. Solo sirve archivos estáticos. |
| DB de control | **Sí** | Es la fuente de verdad (también backupeala, ver [devops-runbook.md §5](devops-runbook.md)). |
| Redis | **Sí** | Persistencia AOF de colas BullMQ y estados de ejecución. |

Para la DB de control, usá la estrategia de volumen de tu plataforma: PVC en K8s, EBS en EC2, SSD local con snapshots diarios en VPS, etc. **Mínimo 20 GiB** para el volumen de la DB de control; crece despacio (los audit logs son el driver principal).

---

## 6. Networking

### Ingress

| Servicio | ¿Necesita ingress? | Protocolo | Notas |
|----------|---------------------|-----------|-------|
| Web | sí | HTTPS (terminar en el ingress) | Es la entrada al usuario |
| API | sí | HTTPS | El Web le pega; si Web y API van al mismo dominio, ruteá `/api/*` a la API |
| DB de control | no | — | Solo interna, nunca exponerla públicamente |

Recomendado: poner ambos detrás del mismo hostname (`envault.example.com` para Web, `envault.example.com/api` para API) para evitar gimnasia de CORS. Si los splittéas (`app.` y `api.`), seteá `CORS_ORIGIN` en la API al dominio exacto del Web.

### Egress

La API necesita acceso de red saliente a:

- **Cloudflare R2** — `*.r2.cloudflarestorage.com` (HTTPS, port 443)
- **Cada DB gestionada/on-prem** que registres como conexión (TCP, varía — típicamente 5432/3306)

Better Auth corre dentro del proceso de la API y conecta a la misma instancia de PostgreSQL — no se necesita egress adicional para auth. El container del Web **no tiene necesidades de red saliente** — solo sirve archivos estáticos.

---

## 7. Restricciones de escalado — LEER ESTO

> ⚠️ **La API es single-replica, hoy.**

El scheduler de cronjobs corre in-process (`@nestjs/schedule`). Si deployás la API con `replicas: 2` (o más), **cada réplica dispara cada backup programado**, produciendo dumps duplicados y desperdicio de R2.

| Servicio | Réplicas máximas | Réplicas mínimas | Por qué |
|----------|------------------|------------------|---------|
| API | **1** | 1 | Scheduler in-process |
| Web | ilimitadas | 1 | nginx puro, totalmente stateless |
| DB de control | 1 primary (+ réplicas si querés HA de lectura, no obligatorio) | 1 | Postgres estándar |

Para HA en la API hoy: configurar una sola réplica con strategy `RollingUpdate` (`maxSurge: 1, maxUnavailable: 0`). En K8s eso implica una indisponibilidad breve durante deploys; si eso es inaceptable, **la migración a BullMQ + Redis en [architecture-roadmap.md §4](architecture-roadmap.md) es el unblocker**, no multi-réplica hoy.

---

## 8. Comportamiento de migración

La API corre migrations al startup con `migrationsRun: true`. Implicancias:

- **No hace falta init container**. El container de la API maneja las migrations solo.
- **El primer boot contra una DB vacía va a fallar** hasta que se genere [la migration `InitialSchema`](database-migrations.md).
- **Rolling deploys con migrations**: TypeORM toma un advisory lock en la tabla `migrations`, así que startups concurrentes son seguros — pero como corrés una sola réplica, esto es académico.
- **Los rollbacks no son triviales**. Una migration que agrega una columna es forward-compatible (la imagen vieja ignora la columna nueva). Una que dropea una columna o cambia un tipo, no. Planificá las migrations para que sean backward-compatible por al menos un release.

---

## 9. Ejemplo mínimo viable de Kubernetes (ilustrativo, NO un template)

> **Better Auth corre dentro de la API — no se necesita ningún servicio de auth externo.** Los usuarios y sesiones se almacenan en la misma instancia de PostgreSQL. Sin Keycloak, sin deploy de auth separado.

Abajo está el set **más chico posible** de manifests para correr EnVault Management en K8s. Es intencionalmente mínimo y **no incluye** ingress, TLS, gestión de secretos, volúmenes persistentes, ni ningún hardening de producción. Tratalo como un punto de partida para verificar el contrato, no como algo para deployar tal cual.

```yaml
# api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: envault-api
spec:
  replicas: 1  # DEBE ser 1 — ver §7
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: envault-api
  template:
    metadata:
      labels:
        app: envault-api
    spec:
      containers:
        - name: api
          image: ghcr.io/your-org/envault-api:0.1.0
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: envault-api-secrets
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
---
# api-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: envault-api
spec:
  selector:
    app: envault-api
  ports:
    - port: 3000
      targetPort: 3000
```

El Web es estructuralmente idéntico — cambiá `3000` por `80`, apuntá las env vars al service de la API, listo. Vos te ocupás del ingress, TLS, secretos y persistencia con lo que ya use tu equipo.

---

## 11. Referencias cruzadas

- Env vars en detalle: [environment-variables.md](environment-variables.md)
- Concerns operativos (monitoreo, rotaciones, respuesta a incidentes): [devops-runbook.md](devops-runbook.md)
- Conectividad de DB desde adentro del cluster: [connecting-cloud-databases.md](connecting-cloud-databases.md) y [connecting-on-premise-databases.md](connecting-on-premise-databases.md)
- Hacia dónde va el proyecto (scheduler multi-réplica, SSL nativo): [architecture-roadmap.md](architecture-roadmap.md)
- Modos de falla comunes: [troubleshooting.md](troubleshooting.md)
