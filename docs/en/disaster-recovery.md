# Disaster Recovery Runbook

> 🇪🇸 Versión en español: [../es/disaster-recovery.md](../es/disaster-recovery.md)

This runbook establishes the official operating procedure for rebuilding the EnVault Management platform and recovering access to managed databases during catastrophic infrastructure incidents.

---

## 1. Recovery Objectives (RTO and RPO)

The following operational metrics define service recovery thresholds:

| Component | RPO (Recovery Point Objective) | RTO (Recovery Time Objective) | Strategy |
|---|---|---|---|
| **Control Database (`envault`)** | 1 hour (with WAL archiving) or 24 hours (with daily dump) | 30 minutes | Restore from offsite dump or replay WAL archives |
| **Managed Databases (PostgreSQL / MySQL)** | Determined by the configured cronjob schedule in R2 | 15 to 45 minutes (depending on dump volume) | Download from R2, verify SHA-256 digest, and transactional restore |
| **API and Web Containers** | 0 minutes (stateless containers) | 10 minutes | Redeploy container images |

---

## 2. Critical Secrets Inventory

To reconstruct the platform from bare metal, operations teams must store the following secrets in an external credential vault:

1. **`ENCRYPTION_KEY`**
   A 64-character hexadecimal string (32 bytes). EnVault uses this key with AES-256-GCM to encrypt and decrypt database credentials in the `connections` table. If this key is lost or altered, stored credentials cannot be decrypted, leaving managed connections unrecoverable.
2. **`BETTER_AUTH_SECRET`**
   Secret key used to sign user authentication cookies and session tokens.
3. **Cloudflare R2 Credentials**
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`. These credentials provide read and write access to database dumps and manifests.
4. **`DATABASE_URL`**
   Connection string for the dedicated PostgreSQL 16+ control database.

Store these values in a hardened enterprise password manager (such as 1Password, HashiCorp Vault, or AWS Secrets Manager) with restricted access limited to on-call engineers.

---

## 3. Cold Bootstrap Procedure

Follow these sequential steps when standing up a fresh EnVault deployment after complete loss of prior compute resources:

### Step 1. Provision the Control Database
Provision a clean PostgreSQL instance running version 16 or newer. Create a dedicated database and user with privileges to create tables and schemas:

```sql
CREATE DATABASE envault;
CREATE USER envault_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE envault TO envault_user;
```

### Step 2. Configure Environment Variables
Create the production environment file by injecting the vaulted secrets. Ensure `NODE_ENV=production` and verify that `ENCRYPTION_KEY` contains exactly 64 characters:

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://envault_user:secure_password@db.internal:5432/envault
ENCRYPTION_KEY=pre_vaulted_64_character_hexadecimal_string
BETTER_AUTH_SECRET=pre_vaulted_authentication_secret
BETTER_AUTH_URL=https://api.envault.example.com
BETTER_AUTH_ADMIN_EMAIL=admin@envault.example.com
BETTER_AUTH_ADMIN_PASSWORD=temporary_initial_password
CORS_ORIGIN=https://app.envault.example.com
R2_ACCOUNT_ID=cloudflare_account_id
R2_ACCESS_KEY_ID=r2_access_key
R2_SECRET_ACCESS_KEY=r2_secret_key
R2_BUCKET_NAME=backup_bucket_name
RESTORE_TIMEOUT_MS=1800000
```

### Step 3. Initialize Database Schemas
Deploy the API container. Upon boot, NestJS runs TypeORM migrations, applying `InitialSchema` and any subsequent migrations automatically:

```bash
docker run -d \
  --name envault-api \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  envault-management-api:latest
```

Check the startup logs to ensure migrations completed cleanly:

```bash
docker logs envault-api
```

### Step 4. Deploy the Web Application
Start the web container, pointing the proxy configuration to the API backend using `API_UPSTREAM`:

```bash
docker run -d \
  --name envault-web \
  --restart unless-stopped \
  -p 80:80 \
  -e API_UPSTREAM=api.internal:3000 \
  -e CSP_HEADER_NAME=Content-Security-Policy \
  envault-management-web:latest
```

### Step 5. Verify System Health
Send an HTTP request to the health check endpoint:

```bash
curl -f http://localhost:3000/health
```

The endpoint must return an HTTP 200 response with status confirmations for the database and Cloudflare R2.

---

## 4. Disaster Recovery Scenarios

### Scenario A. Recovering the Control Database from an Offsite Backup
When a recent offsite dump of the `envault` control database is available:

1. Temporarily stop the `envault-api` container.
2. Restore the dump into the clean control database:
   ```bash
   pg_restore -h db.internal -p 5432 -U envault_user -d envault --clean --if-exists offsite_control_backup.dump
   ```
3. Restart `envault-api`.
4. Log in to the web interface and confirm that connections and scheduled cronjobs appear properly.

### Scenario B. Forensic Reconstruction Directly from Cloudflare R2
If the control database is lost without any backup, raw database dumps remain preserved inside Cloudflare R2. Every backup generates two companion objects in the bucket:

* `path/to/backup.dump`: binary dump stream.
* `path/to/backup.manifest.json`: version 2 metadata manifest containing verification details.

To reconstruct operations:

1. List bucket contents using the AWS CLI or Rclone:
   ```bash
   aws s3 ls s3://backup_bucket_name/ --recursive --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
   ```
2. Download and inspect the newest `.manifest.json` file for each connection:
   ```json
   {
     "version": 2,
     "createdAt": "2026-09-24T03:00:00.000Z",
     "dbType": "postgres",
     "database": "corporate_erp",
     "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
     "bytes": 524288000,
     "source": {
       "tableCount": 42,
       "rowCount": 150000,
       "sizeBytes": 524288000
     }
   }
   ```
3. Re-register the database connection in EnVault using the matching database engine and database name found in the manifest.
4. Navigate to the restore module, select the matching dump from R2, and restore it into a non-production target to validate data consistency.

### Scenario C. Restoring a Failed Managed Database
When a production or staging database experiences corruption or accidental loss:

1. Sign in to EnVault Management as an administrator.
2. Open the Restore section and locate the latest completed dump for the target connection.
3. Choose a verified non-production target (DEV or SQA). Direct restores to production connections are blocked by design.
4. EnVault downloads the dump, computes its cryptographic SHA-256 digest in flight, verifies it against the recorded manifest digest, and executes the structural preflight check before modifying the target database.
5. After validation in the non-production environment, coordinate with application owners to execute the planned cutover.

---

## 5. Regular Operational Drills

Backup pipelines require periodic verification to ensure disaster preparedness. Conduct the following operational drills on schedule:

* **Monthly:** Run the automated drill script `scripts/restore-drill.sh` against the local sandbox database containers (`db-test-pg` and `db-test-mysql`).
* **Quarterly:** Conduct a dry-run cold bootstrap on an isolated machine using offsite backups and vaulted `ENCRYPTION_KEY` credentials.
* **Bi-annually:** Audit Cloudflare R2 bucket access permissions and rotate active API tokens.
