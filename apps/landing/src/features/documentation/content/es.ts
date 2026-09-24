import { API_BASE_URL_TOKEN, type DocContent } from './types';

export const es: DocContent = {
  pageTitle: 'Documentación | EnVault Management',
  pageDescription:
    'Guía técnica para registrar bases de datos, programar respaldos automatizados, configurar Cloudflare R2 / S3 y restaurar volcados en EnVault Management.',
  breadcrumbLabel: 'Guía de Arquitectura y APIs',
  tocLabel: 'Tabla de contenidos',
  heroTitle: 'Documentación Técnica',
  heroSubtitle:
    'Especificación técnica y guía de integración para EnVault Management. Explora la arquitectura de locks distribuidos, endpoints REST, streaming SSE y almacenamiento multi-cloud.',
  copyCodeLabel: 'Copiar código',
  copiedLabel: '¡Copiado!',
  navGroups: [
    { label: 'Introducción', sectionIds: ['getting-started', 'architecture-overview'] },
    {
      label: 'Guía de Despliegue',
      sectionIds: ['deployment-docker', 'control-db-requirements', 'storage-configuration'],
    },
    {
      label: 'Referencia de la API',
      sectionIds: ['api-dumps-execute', 'api-restore-execute', 'api-sse-telemetry', 'api-audit-log'],
    },
    { label: 'Operaciones & DevOps', sectionIds: ['scheduler-locks-guide', 'retention-cleanup'] },
  ],
  sections: [
    {
      id: 'getting-started',
      navLabel: 'Visión general',
      title: 'Visión general de EnVault Management',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management es una plataforma centralizada de operaciones y respaldo de bases de datos. Permite registrar conexiones a PostgreSQL y MySQL, programar backups automáticos con expresiones cron y zona horaria, monitorear la ejecución en tiempo real mediante SSE y restaurar bases de datos con validaciones estrictas de integridad.',
        },
        { type: 'subheading', text: 'Requisitos no negociables del sistema' },
        {
          type: 'paragraph',
          text: 'La base de datos de control de EnVault Management debe ser PostgreSQL 16 o superior. El sistema utiliza tipos enum nativos, columnas JSONB y transacciones concurrentes con locks distribuidos gestionados por TypeORM y NestJS 11.',
        },
        {
          type: 'table',
          headers: ['Componente', 'Tecnología', 'Versión', 'Propósito'],
          rows: [
            ['Control DB', 'PostgreSQL', '16+ (Obligatorio)', 'Estado del sistema, locks, credenciales cifradas y auditoría'],
            ['Backend API', 'NestJS', '11.0+', 'Monolito modular, streaming de dumps y endpoints SSE'],
            ['Frontend Web', 'React & Vite', '19.1+ / Vite 6+', 'Panel de control administrativo con TanStack Query'],
            ['Storage Bucket', 'Cloudflare R2 / S3', 'S3 API Compatible', 'Almacenamiento cifrado en reposo para dumps gzip'],
          ],
        },
      ],
    },
    {
      id: 'architecture-overview',
      navLabel: 'Arquitectura',
      title: 'Arquitectura Zero-Trust y Locks Distribuidos',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management separa estrictamente el plano de control (donde reside el estado administrativo) de las bases de datos gestionadas. Las credenciales se almacenan cifradas con AES-256-GCM y nunca se transmiten descifradas al navegador web.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `# Arquitectura del monorepo
apps/
  ├── api/     # NestJS 11 — Modular Monolith (Port 3000)
  ├── web/     # React 19 — Vertical Slice (Port 5173 / 80)
  └── landing/ # Astro 7 — SSG Showcase & Documentation (Port 4321)`,
        },
      ],
    },
    {
      id: 'deployment-docker',
      navLabel: 'Despliegue Docker',
      title: 'Despliegue con Docker Compose',
      blocks: [
        {
          type: 'paragraph',
          text: 'Puedes iniciar la pila completa de EnVault Management con un único comando. La pila incluye el contenedor de la API, el contenedor web y una instancia de PostgreSQL 16 configurada con volúmenes persistentes.',
        },
        {
          type: 'code',
          language: 'yaml',
          code: `services:
  control-db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: envault_control
      POSTGRES_USER: envault
      POSTGRES_PASSWORD: \${CONTROL_DB_PASSWORD}
    volumes:
      - envault_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U envault -d envault_control"]
      interval: 5s
      timeout: 5s
      retries: 5

  envault-api:
    image: ghcr.io/envault/api:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - CONTROL_DB_HOST=control-db
      - CONTROL_DB_PORT=5432
      - CONTROL_DB_NAME=envault_control
      - STORAGE_BACKEND=r2
      - R2_BUCKET=prod-db-backups
    depends_on:
      control-db:
        condition: service_healthy

volumes:
  envault_data:`,
        },
      ],
    },
    {
      id: 'control-db-requirements',
      navLabel: 'Base de Control',
      title: 'Configuración de la Base de Datos de Control',
      blocks: [
        {
          type: 'paragraph',
          text: 'El motor de TypeORM se conecta a la base de control al iniciar y ejecuta automáticamente las migraciones pendientes. Las tablas críticas incluyen `connections`, `cronjobs`, `scheduler_locks`, `dump_executions` y `audit_logs`.',
        },
      ],
    },
    {
      id: 'storage-configuration',
      navLabel: 'Almacenamiento Cloud',
      title: 'Configuración de Cloudflare R2 y AWS S3',
      blocks: [
        {
          type: 'paragraph',
          text: 'Los volcados se transmiten vía streaming multipart al proveedor de objetos configurado. Esto evita agotar el espacio en disco en los servidores de aplicación incluso al respaldar bases de datos de cientos de gigabytes.',
        },
      ],
    },
    {
      id: 'api-dumps-execute',
      navLabel: 'API: Ejecutar Dump',
      title: 'Endpoint REST: Ejecutar Respaldo Manual',
      blocks: [
        {
          type: 'paragraph',
          text: 'Inicia un trabajo de respaldo asíncrono sobre una base de datos registrada. Devuelve el identificador del job y la URL del canal SSE para seguimiento.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/dumps/execute" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connectionId": "conn_prod_pg",
    "compression": "gzip",
    "retentionDays": 30,
    "lockTimeoutMs": 60000
  }'`,
        },
      ],
    },
    {
      id: 'api-restore-execute',
      navLabel: 'API: Restaurar Base',
      title: 'Endpoint REST: Restaurar Dump',
      blocks: [
        {
          type: 'paragraph',
          text: 'Ejecuta la restauración de un volcado sobre una conexión de destino. Admite el modo de simulación (`dryRun: true`) para validar conectividad y compatibilidad antes de aplicar cambios.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/restore/execute" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "dumpId": "dump_2026_09_24_pg_main",
    "targetConnectionId": "conn_staging_pg",
    "dryRun": false,
    "verifyIntegritySha256": true
  }'`,
        },
      ],
    },
    {
      id: 'api-sse-telemetry',
      navLabel: 'API: Streaming SSE',
      title: 'Telemetría de Jobs en Vivo vía Server-Sent Events',
      blocks: [
        {
          type: 'paragraph',
          text: 'Conéctate al endpoint SSE para recibir eventos en tiempo real sobre el progreso de volcado, bytes transferidos a R2 y estado final sin necesidad de polling.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -N -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/jobs/events?jobId=job_9412"`,
        },
      ],
    },
    {
      id: 'api-audit-log',
      navLabel: 'API: Auditoría',
      title: 'Registro Inmutable de Auditoría',
      blocks: [
        {
          type: 'paragraph',
          text: 'Consulta el historial de todas las acciones operativas ejecutadas en la plataforma: inicio de backups, descargas de volcados, actualizaciones de credenciales y restauraciones.',
        },
      ],
    },
    {
      id: 'scheduler-locks-guide',
      navLabel: 'Scheduler Locks',
      title: 'Exclusión Mutua con Scheduler Locks',
      blocks: [
        {
          type: 'paragraph',
          text: 'Para prevenir condiciones de carrera cuando múltiples réplicas de la API de EnVault ejecutan cronjobs, cada tarea adquiere un lock transaccional en la tabla `scheduler_locks`. Si otra réplica intenta ejecutar el mismo job en la misma ventana, el lock previene la ejecución duplicada.',
        },
      ],
    },
    {
      id: 'retention-cleanup',
      navLabel: 'Limpieza y Retención',
      title: 'Políticas de Retención y Auto-Pruning',
      blocks: [
        {
          type: 'paragraph',
          text: 'El módulo de mantenimiento ejecuta periódicamente tareas de auto-pruning que eliminan volcados que han superado su periodo de retención, liberando espacio en tus buckets S3/R2 automáticamente.',
        },
      ],
    },
  ],
};
