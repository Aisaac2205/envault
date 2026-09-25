# Runbook de Disaster Recovery

> 🇬🇧 English version: [../en/disaster-recovery.md](../en/disaster-recovery.md)

Este documento establece el procedimiento oficial para reconstruir la plataforma EnVault Management y recuperar el acceso a las bases de datos gestionadas ante pérdidas catastróficas de infraestructura.

---

## 1. Objetivos de Recuperación (RTO y RPO)

Los siguientes objetivos definen los límites operativos del servicio:

| Componente | RPO (Punto Máximo de Pérdida) | RTO (Tiempo Máximo de Retorno) | Estrategia |
|---|---|---|---|
| **Base de Control (`envault`)** | 1 hora (con WAL archiving) o 24 horas (con dump diario) | 30 minutos | Restore de dump offsite o reproducción de WALs |
| **Bases Gestionadas (PostgreSQL / MySQL)** | Determinado por la frecuencia del cronjob en R2 | 15 a 45 minutos (según tamaño del dump) | Descarga de R2, validación SHA-256 y restore transaccional |
| **Instancia Web y API** | 0 minutos (sin estado persistente local) | 10 minutos | Re-despliegue de contenedores Docker |

---

## 2. Inventario de Secretos Críticos

Para reconstruir la plataforma desde cero, el equipo de operaciones debe custodiar fuera de la infraestructura principal los siguientes valores:

1. **`ENCRYPTION_KEY`**
   Cadena hexadecimal de 64 caracteres (32 bytes). Se utiliza con AES-256-GCM para cifrar y descifrar las contraseñas de las bases de datos gestionadas en la tabla `connections`. Si este valor se pierde o se altera, ninguna contraseña registrada podrá descifrarse y las conexiones quedarán inutilizables.
2. **`BETTER_AUTH_SECRET`**
   Cadena secreta utilizada para firmar las cookies de sesión y tokens de autenticación de usuarios.
3. **Credenciales de Cloudflare R2**
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET_NAME`. Permiten acceder al almacenamiento de los volcados y manifiestos.
4. **`DATABASE_URL`**
   Cadena de conexión hacia la base de datos PostgreSQL 16+ dedicada para el control de EnVault.

Conserve estos secretos en un gestor corporativo seguro (como 1Password, HashiCorp Vault o AWS Secrets Manager) con acceso restringido al personal de guardia.

---

## 3. Procedimiento de Arranque en Frío (Cold Bootstrap)

Siga este orden estricto cuando deba levantar una instalación limpia de EnVault tras la destrucción total del servidor o cluster previo:

### Paso 1. Aprovisionar la Base de Datos de Control
Cree una instancia nueva de PostgreSQL versión 16 o superior. Configure un usuario dedicado con permisos para crear tablas y esquemas:

```sql
CREATE DATABASE envault;
CREATE USER envault_user WITH ENCRYPTED PASSWORD 'contraseña_segura';
GRANT ALL PRIVILEGES ON DATABASE envault TO envault_user;
```

### Paso 2. Configurar el Entorno
Cree el archivo de variables `.env` inyectando los secretos custodiados. Verifique que `NODE_ENV=production` y que `ENCRYPTION_KEY` tenga exactamente 64 caracteres:

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://envault_user:contraseña_segura@db.internal:5432/envault
ENCRYPTION_KEY=clave_hex_de_64_caracteres_previamente_custodiada
BETTER_AUTH_SECRET=secreto_de_autenticacion_custodiado
BETTER_AUTH_URL=https://api.envault.ejemplo.com
BETTER_AUTH_ADMIN_EMAIL=admin@envault.ejemplo.com
BETTER_AUTH_ADMIN_PASSWORD=contraseña_inicial_temporal
CORS_ORIGIN=https://app.envault.ejemplo.com
R2_ACCOUNT_ID=cuenta_cloudflare_r2
R2_ACCESS_KEY_ID=clave_acceso_r2
R2_SECRET_ACCESS_KEY=secreto_acceso_r2
R2_BUCKET_NAME=nombre_del_bucket
RESTORE_TIMEOUT_MS=1800000
```

### Paso 3. Inicializar el Esquema
Despliegue el contenedor de la API. Durante el inicio, NestJS ejecuta automáticamente TypeORM y aplica la migración base `InitialSchema` junto con las migraciones pendientes:

```bash
docker run -d \
  --name envault-api \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  envault-management-api:latest
```

Verifique los registros de arranque para confirmar que las migraciones se aplicaron sin errores:

```bash
docker logs envault-api
```

### Paso 4. Desplegar la Interfaz Web
Inicie el contenedor web vinculando la dirección del backend mediante la variable `API_UPSTREAM`:

```bash
docker run -d \
  --name envault-web \
  --restart unless-stopped \
  -p 80:80 \
  -e API_UPSTREAM=api.internal:3000 \
  -e CSP_HEADER_NAME=Content-Security-Policy \
  envault-management-web:latest
```

### Paso 5. Comprobar la Salud del Sistema
Ejecute una consulta HTTP contra el endpoint de salud de la API:

```bash
curl -f http://localhost:3000/health
```

La respuesta debe indicar código 200 y reportar el estado de la base de datos y de Cloudflare R2.

---

## 4. Escenarios de Recuperación

### Escenario A. Restauración de la Base de Control desde Copia Offsite
Si dispone de una copia de seguridad reciente de la base `envault`:

1. Detenga temporalmente el contenedor `envault-api`.
2. Restaure el volcado en la base limpia:
   ```bash
   pg_restore -h db.internal -p 5432 -U envault_user -d envault --clean --if-exists copia_control_offsite.dump
   ```
3. Inicie el contenedor `envault-api`.
4. Inicie sesión y verifique que las conexiones y los cronjobs aparezcan en el panel.

### Escenario B. Reconstrucción Forense Directamente desde R2
Si la base de datos de control se destruyó por completo sin copia de respaldo, los volcados de sus bases de datos gestionadas siguen intactos en Cloudflare R2. Cada respaldo almacena dos archivos asociados:

* `ruta/al/volcado.dump`: archivo comprimido con los datos físicos.
* `ruta/al/volcado.manifest.json`: manifiesto versión 2 con metadatos de integridad.

Para recuperar la información:

1. Liste los objetos del bucket utilizando la herramienta oficial de AWS o Rclone:
   ```bash
   aws s3 ls s3://nombre_del_bucket/ --recursive --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
   ```
2. Descargue e inspeccione el archivo `.manifest.json` más reciente de cada conexión:
   ```json
   {
     "version": 2,
     "createdAt": "2026-09-24T03:00:00.000Z",
     "dbType": "postgres",
     "database": "erp_corporativo",
     "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
     "bytes": 524288000,
     "source": {
       "tableCount": 42,
       "rowCount": 150000,
       "sizeBytes": 524288000
     }
   }
   ```
3. Registre nuevamente la conexión en la interfaz de EnVault utilizando el mismo motor y nombre de base de datos indicado en el manifiesto.
4. Concurra a la sección de restauración, seleccione el volcado correspondiente desde R2 y ejecute la recuperación hacia un entorno no productivo para certificar los datos.

### Escenario C. Restauración de una Base de Datos Gestionada Destruida
Cuando una base de datos operativa sufre un incidente grave:

1. Ingrese a la interfaz de EnVault Management con rol de administrador.
2. Diríjase al módulo de Restauración y localice el volcado más reciente de la conexión afectada.
3. Seleccione una conexión destino de entorno no productivo (DEV o SQA).
4. El sistema descargará el volcado, validará su digest criptográfico SHA-256 en memoria antes de escribir en el motor destino y comprobará la integridad estructural del archivo.
5. Tras completar la restauración en el entorno de pruebas y certificar la integridad con el equipo dueño de los datos, planifique la ventana de migración hacia producción.

---

## 5. Simulacros Periódicos (Drills)

Una estrategia de respaldo sin pruebas periódicas de restauración ofrece una falsa sensación de seguridad. Ejecute las siguientes acciones según el calendario establecido:

* **Mensual:** Ejecutar el script automatizado `scripts/restore-drill.sh` contra los motores de prueba locales (`db-test-pg` y `db-test-mysql`).
* **Trimestral:** Simular la reconstrucción de la base de control en un servidor independiente utilizando las copias de seguridad offsite y la clave `ENCRYPTION_KEY` custodiada.
* **Semestral:** Auditoría de permisos en Cloudflare R2 y rotación de tokens de acceso.
