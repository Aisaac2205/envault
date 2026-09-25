# Runbook DevOps

> 🇬🇧 English version: [../en/devops-runbook.md](../en/devops-runbook.md)

Guía operativa para correr EnVault Management en producción. Cubre qué monitorear, qué backupear, cómo rotar, cómo responder a incidentes comunes. Inclinada hacia "hacé esto el día uno, te vas a agradecer el día noventa".

---

## 1. Checklist pre-producción

Antes de pasar a producción, confirmá:

### Infraestructura

- [ ] La API y Web de EnVault Management corren en una sola réplica cada una (multi-réplica rompe el scheduler — ver [scheduler-architecture.md](scheduler-architecture.md))
- [ ] La DB PostgreSQL de control es **dedicada** (no compartida con otras apps)
- [ ] La DB de control tiene backups automáticos configurados (EnVault Management NO se backupea a sí mismo)
- [ ] HTTPS está terminado delante del service web (Railway lo hace solo; para self-host, usar Caddy/nginx/Traefik)
- [ ] `CORS_ORIGIN` está seteado al dominio exacto del frontend (sin wildcards)
- [ ] `NODE_ENV=production` está seteado en el service de la API

### Secretos

- [ ] Las credenciales de R2 son **dedicadas** para EnVault Management (no compartidas con otras apps)
- [ ] El bucket R2 tiene **versionado habilitado** (defensa contra borrado accidental)
- [ ] `BETTER_AUTH_SECRET` está en un secrets manager, no en `.env`
- [ ] No hay archivos `.env` commiteados (`git log --all --full-history -- '*.env'` debería estar vacío)

### Auth

- [ ] `BETTER_AUTH_SECRET` está seteado con al menos 32 bytes de entropía aleatoria
- [ ] `BETTER_AUTH_URL` coincide con el dominio público de la API (se usa para el dominio de cookie/CORS)
- [ ] El usuario admin seed existe (verificar vía `/api/auth/admin/users` o consulta a la tabla `user`)
- [ ] Al menos un usuario no-admin fue creado y puede loguearse exitosamente

### Aplicación

- [ ] La migration `InitialSchema` fue generada (ver [database-migrations.md](database-migrations.md))
- [ ] El endpoint `/health` devuelve 200 desde el entorno deployado
- [ ] Hay al menos una conexión registrada y testeada
- [ ] Se completó un ciclo end-to-end de backup → restore-a-DEV exitoso

---

## 2. Qué monitorear

### Alertas críticas (paginar a alguien ya)

| Métrica | Threshold | Por qué |
|---------|-----------|---------|
| Status de `/health` de la API | No-200 por > 2 min | EnVault Management está caído |
| Cantidad de conexiones de la DB de control | > 80% de `max_connections` | Leak de conexiones o issue de escala |
| Tasa de errores 4xx de R2 | Sostenida > 5 min | Credenciales revocadas, bucket mal configurado |
| Tasa de fallo de backup jobs | > 20% en la última hora | Patrón de fallas, no un caso aislado |

### Alertas de warning (acknowledge en pocas horas)

| Métrica | Threshold | Por qué |
|---------|-----------|---------|
| Duración de backup job | 2× el promedio rolling de 7 días | Crecimiento de DB, ralentización de red |
| Crecimiento de bucket R2 | Spike repentino o aplanamiento repentino | Retención mal configurada o jobs atascados |
| `nextRunAt` de cronjob | Más de 1 hora en el pasado con `isActive: true` | El scheduler no está disparando |
| Volumen de audit log | Cambio de un orden de magnitud | O un bug o un evento de seguridad |

### Paneles recomendados del dashboard

- Tasa de 5xx de la API (últimas 24h)
- Distribución de estado de backup jobs (completed / failed / running) en el tiempo
- Tamaño y cantidad de objetos del bucket R2
- Conexiones activas por environment
- Últimas entradas del audit log con filtro por usuario

Para stacks de Prometheus/Grafana, EnVault Management **no** expone `/metrics` actualmente. Trackeá en la capa de infra (stats del container, pg_stat_*).

---

## 3. Operaciones rutinarias

### 3.1 Agregar una nueva conexión a DB gestionada

1. Verificar conectividad desde el host de EnVault Management (`nc -zv <host> <port>`) — ver [troubleshooting §2](troubleshooting.md).
2. Crear un usuario DB dedicado con permisos mínimos ([flow-database-management.md §permisos](flow-database-management.md)).
3. Registrar la conexión desde la UI de EnVault Management.
4. Testear la conexión desde la UI.
5. Disparar un backup manual; verificar que aparezca en R2 y en el historial.
6. Configurar el schedule del cronjob.

### 3.2 Rotar credenciales de conexión

Hoy no hay rotación built-in. Procedimiento manual:

1. En la DB origen, crear un usuario nuevo con los mismos permisos que el viejo.
2. En EnVault Management: registrar una conexión NUEVA con las credenciales nuevas (no edites la PROD existente — los edits a PROD están bloqueados por diseño).
3. Migrar los cronjobs para apuntar a la conexión nueva (desde la UI).
4. Correr un backup de verificación.
5. Una vez estable, dejar la vieja en su lugar (soft-delete si es no-PROD; las PROD no se pueden borrar).
6. En la DB origen, droppear el usuario viejo.

### 3.3 Rotar el password de la DB propia de EnVault Management

1. En la DB de control: `ALTER USER envault_control WITH PASSWORD 'nuevo-password-fuerte';`
2. Actualizar `DATABASE_URL` en la config del service de la API.
3. Redeploy (rolling restart está bien, una sola réplica).
4. Confirmar que `/health` devuelve 200.

### 3.4 Rotar credenciales de R2

1. En Cloudflare Dashboard → R2 → Manage R2 API Tokens → crear token nuevo con scope `Object Read & Write` sobre el bucket de EnVault Management.
2. Actualizar `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` en la config del service de la API.
3. Redeploy.
4. Disparar un backup manual; confirmar que llega a R2.
5. Borrar el token viejo de Cloudflare.

### 3.5 Restaurar un dump a un target no-PROD

1. Desde la UI de EnVault Management → Restore → elegir el dump de R2.
2. Elegir la conexión target (debe ser DEV o SQA — PROD está bloqueado).
3. Confirmar el prompt de type-to-confirm.
4. Monitorear el restore job hasta `completed`.
5. Verificar en la DB target consultando una tabla conocida.

---

## 4. Playbooks de respuesta a incidentes

### 4.1 EnVault Management está totalmente caído

**Triaje en este orden**:

1. **¿El container de la API está corriendo?**
   ```bash
   docker ps | grep envault-api
   # O en Railway: Service → Deployments → chequear status
   ```
2. **¿Los logs dicen algo?**
   ```bash
   docker logs --tail 200 envault-api
   ```
3. **¿La DB de control es alcanzable desde la API?**
   ```bash
   docker exec envault-api pg_isready -h <DB_HOST> -p <DB_PORT>
   ```
4. **¿Better Auth está respondiendo?**
   ```bash
   curl -I <API_URL>/api/auth/ok
   ```

Si 1 falla: reiniciar el container. Si 2 muestra que la API crasheó al arrancar: chequear [troubleshooting §1.1](troubleshooting.md). Si 3 falla: la DB está caída o la red rota. Si 4 falla: Better Auth no está respondiendo — verificar que `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` estén seteados correctamente y que la API tenga acceso a la DB.

### 4.2 Los backups empiezan a fallar todos

1. Chequear los mensajes de error de los últimos 5 jobs fallados: ¿son todos el mismo error?
2. Si "`pg_dump` version mismatch": [troubleshooting §3.2](troubleshooting.md).
3. Si "connection timeout": ¿el proveedor de DB cambió algo? Chequear status page del proveedor.
4. Si errores de R2: chequear status de Cloudflare, después chequear credenciales.
5. Si es algo más raro: abrir los logs de la API y mirar el stack trace real.

### 4.3 Bucket R2 cerca de quota

1. Listar dumps viejos:
   ```sql
   SELECT file_key, file_size_mb, created_at
   FROM backup_jobs
   WHERE status = 'completed' AND created_at < NOW() - INTERVAL '90 days'
   ORDER BY created_at;
   ```
2. Decidir política de retención con stakeholders.
3. Hoy no hay cleanup automático. Borrado manual:
   - Desde la UI de R2 de Cloudflare (lento, doloroso con muchos objetos).
   - O con CLI `rclone` / `aws s3` contra el endpoint de R2.
4. Después del borrado, actualizar las filas de `backup_jobs` para marcarlos como archivados/borrados (o dejarlos como registro histórico — `connectionName` igual va a mostrar `(eliminada)` si la conexión origen ya no está).

### 4.4 Actividad sospechosa en audit logs

1. Filtrar audit log por usuario:
   ```sql
   SELECT * FROM audit_logs WHERE user_id = '<sospechoso>' ORDER BY created_at DESC LIMIT 100;
   ```
2. Buscar patrones: intentos fallidos de modificar PROD (bien — los guards funcionaron), intentos inusuales de restore-desde-PROD, creación masiva de conexiones.
3. Si se comprometió una sesión: revocarla vía la API admin de Better Auth, o rotar `BETTER_AUTH_SECRET` para invalidar TODAS las sesiones simultáneamente. Rotar credenciales de R2 de EnVault Management como defensa en profundidad.
4. El audit log **no es criptográficamente inmutable** — un DBA con acceso a la DB de control puede editarlo ([security-model.md §3](security-model.md)). Exportá las filas sospechosas a un sistema separado antes de investigar, por si las adulteran.

---

## 5. Backup y Supervivencia de la DB de Control

EnVault Management respalda sus bases de datos gestionadas, pero no se respalda a sí misma.

Si la base de datos de control se destruye, se pierde:
- Cada conexión registrada (credenciales, hosts y nombres).
- La capacidad de descifrar contraseñas si no se preserva la variable `ENCRYPTION_KEY`.
- La programación de los cronjobs.
- El historial completo de auditoría.
- El catálogo e índice que mapea los volcados guardados en R2.

Consulte el procedimiento integral de reconstrucción en [disaster-recovery.md](disaster-recovery.md).

### Custodia Crítica de ENCRYPTION_KEY
Las contraseñas de las conexiones se guardan cifradas con AES-256-GCM. Un respaldo de la base de control resulta inútil sin la clave exacta de 64 caracteres hexadecimales configurada en `ENCRYPTION_KEY`. Guarde esta clave en un baúl de contraseñas externo y fuera de la infraestructura principal.

### Estrategia Mínima Aceptable
- `pg_dump` diario de la base de control hacia un destino externo y aislado (nunca en el mismo bucket R2 que utiliza EnVault).
- Retención mínima de 30 días para copias diarias.
- Comando recomendado para volcado de control:
  ```bash
  pg_dump -h db.internal -p 5432 -U envault_user -d envault -F c -f "envault_control_$(date +%Y%m%d_%H%M%S).dump"
  ```

### Estrategia de Grado de Producción
- Archivado continuo de WAL (WAL-G o pgBackRest) con recuperación en el punto del tiempo (PITR).
- Replicación geográfica de la base de control.
- Simulacros trimestrales de reconstrucción completa siguiendo [disaster-recovery.md](disaster-recovery.md).

En despliegues en Railway, active los respaldos automáticos del complemento de PostgreSQL. En servidores dedicados o contenedores propios, configure una tarea cron en un servidor independiente.

---

## 6. Procedimiento de upgrade / deploy

Para un deploy rutinario (nueva versión de imagen):

1. Verificar que CI pasó en `main` y la imagen se publicó.
2. Chequear el changelog (`CHANGELOG.md` o GitHub Releases) por breaking changes.
3. Si hay migrations nuevas: confirmar que corrieron exitosamente en un entorno no-prod primero.
4. Deployar el service de la API primero, después el del Web (para que el Web pegue una API compatible).
5. Mirar logs por 5 minutos; si hay errores, rollback al tag de imagen anterior.
6. Smoke test: listar conexiones, disparar un backup manual, verificar que aparezca.

Para un upgrade de versión mayor:
- Leer las notas de migración del release.
- Tomar un backup manual de la DB de control **antes** del deploy.
- Tener un plan de rollback documentado por escrito.

---

## 7. Lo que NO está automatizado aún

Cosas que esperarías que estén automatizadas pero no lo están, hoy:

- **Políticas de lifecycle / retención de R2** para dumps viejos
- **Audit trail de cronjobs** (los cronjobs corren in-process y no pasan por el interceptor de audit HTTP)
- **Recordatorios de rotación de secretos**
- **Health check más allá de `/health` 200** (sin health de dependencias, sin chequeo de latencia de DB)
- **Endpoint de métricas** (`/metrics` para Prometheus)
- **Logs estructurados en JSON** (hoy los logs están desestructurados estilo nest)

Buenos candidatos para el roadmap — ver [architecture-roadmap.md](architecture-roadmap.md).
