import { API_BASE_URL_TOKEN, type DocContent } from './types';

export const es: DocContent = {
  pageTitle: 'Documentación | EnVault Management',
  pageDescription:
    'Una guía práctica para registrar bases de datos, programar copias de seguridad automáticas, configurar el almacenamiento en Cloudflare R2 y restaurar volcados de forma segura en EnVault Management.',
  breadcrumbLabel: 'Guía de Arquitectura y APIs',
  tocLabel: 'Tabla de contenidos',
  heroTitle: 'Documentación',
  heroSubtitle:
    'Una guía práctica para poner en marcha EnVault Management por tu cuenta. Registra tus bases de datos, programa copias de seguridad, sigue los trabajos en vivo y restaura con seguridad cuando lo necesites.',
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
      sectionIds: [
        'api-dumps-execute',
        'api-restore-execute',
        'api-sse-telemetry',
        'api-audit-log',
        'other-languages',
      ],
    },
    { label: 'Operaciones & DevOps', sectionIds: ['scheduler-locks-guide', 'retention-cleanup'] },
  ],
  sections: [
    {
      id: 'getting-started',
      navLabel: 'Visión general',
      title: 'Qué hace EnVault Management',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management es una plataforma autoalojada para hacer copias de seguridad de tus bases de datos y restaurarlas cuando lo necesites. Registra una conexión a PostgreSQL o MySQL, programa copias de seguridad con una expresión cron y zona horaria, y sigue cada trabajo en vivo desde tu navegador. Antes de restaurar datos de verdad, puedes ejecutar una prueba que revisa la conectividad y la compatibilidad del esquema sin tocar nada.',
        },
        { type: 'subheading', text: 'Antes de instalar EnVault Management' },
        {
          type: 'paragraph',
          text: 'EnVault Management guarda su propio estado (las conexiones, los horarios, las credenciales cifradas y el registro de auditoría) en una base de datos de control, y esa base de datos de control debe ejecutar PostgreSQL 16 o una versión superior. Las versiones anteriores no funcionan. La plataforma depende de los bloqueos consultivos (advisory locks) de PostgreSQL y de columnas JSONB para coordinar los trabajos de forma segura entre réplicas.',
        },
        {
          type: 'table',
          headers: ['Requisito', 'Versión', 'Por qué importa'],
          rows: [
            [
              'Base de datos de control',
              'PostgreSQL 16+',
              'Guarda tus conexiones, horarios, credenciales cifradas y el registro de auditoría',
            ],
            [
              'Bases de datos respaldadas',
              'PostgreSQL o MySQL',
              'Las bases de datos que registras para respaldar y restaurar',
            ],
            [
              'Almacenamiento de objetos',
              'Cloudflare R2',
              'Donde se transmite y guarda cada volcado, mediante una API compatible con S3',
            ],
          ],
        },
      ],
    },
    {
      id: 'architecture-overview',
      navLabel: 'Arquitectura',
      title: 'Cómo EnVault mantiene tus datos seguros',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault mantiene su propio plano de control, donde viven los metadatos de los trabajos, los horarios y el historial de auditoría, separado de las bases de datos que respalda. Las credenciales de conexión se cifran con AES-256-GCM antes de guardarse, y nunca se envían a tu navegador sin cifrar.',
        },
        { type: 'subheading', text: 'Qué ganas con esto' },
        {
          type: 'list',
          items: [
            'Cada usuario es administrador o usuario común. No existe un nivel intermedio de operador ni de solo lectura que tengas que configurar.',
            'Una restauración nunca puede apuntar a una conexión marcada como producción, así que un clic equivocado no puede sobrescribir una base de datos en vivo.',
            'Cada mutación (disparar una copia de seguridad, una descarga, un cambio de conexión, un intento de restauración) queda registrada en un registro de auditoría que no se puede editar ni borrar después, ni siquiera por un administrador.',
          ],
        },
      ],
    },
    {
      id: 'deployment-docker',
      navLabel: 'Despliegue con Docker',
      title: 'Despliegue con Docker Compose',
      blocks: [
        {
          type: 'paragraph',
          text: 'Puedes levantar toda la pila, la API y una base de datos PostgreSQL 16, con un solo comando. El archivo de Docker Compose de abajo guarda la base de datos de control en un volumen con nombre, así que reiniciar los contenedores no borra tus datos.',
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
      title: 'Configurar la base de datos de control',
      blocks: [
        {
          type: 'paragraph',
          text: 'El esquema de la base de datos de control se crea y se mantiene actualizado automáticamente la primera vez que arranca la API, así que no hay ningún comando de migración que tengas que ejecutar a mano. Ahí se guardan tus conexiones registradas, los horarios de copias de seguridad, las credenciales cifradas y el registro de auditoría.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Apunta EnVault a una base de datos PostgreSQL dedicada, en lugar de reutilizar una de las bases que planeas respaldar. Mantener la base de datos de control separada hace que las restauraciones y las actualizaciones sean mucho menos riesgosas.',
        },
      ],
    },
    {
      id: 'storage-configuration',
      navLabel: 'Almacenamiento en la nube',
      title: 'Configuración del almacenamiento en Cloudflare R2',
      blocks: [
        {
          type: 'paragraph',
          text: 'Cada copia de seguridad se transmite directamente a Cloudflare R2 mediante una carga multipartes mientras el volcado todavía se está generando, así que nada toca el disco local, ni siquiera cuando la base de datos de origen pesa cientos de gigabytes. R2 es el único almacenamiento que EnVault admite por ahora. No hay opción de disco local ni otro proveedor de nube que configurar.',
        },
        {
          type: 'paragraph',
          text: 'Como R2 expone una API compatible con S3, la configuras igual que configurarías cualquier cliente compatible con S3. Solo necesitas un endpoint, un nombre de bucket y un par de claves de acceso con permiso para leer y escribir objetos.',
        },
      ],
    },
    {
      id: 'api-dumps-execute',
      navLabel: 'API: Iniciar copia',
      title: 'Endpoint REST: disparar una copia de seguridad manual',
      blocks: [
        {
          type: 'paragraph',
          text: 'Inicia un trabajo de copia de seguridad asíncrono para una conexión registrada y devuelve su ID de trabajo de inmediato, antes de que el volcado termine de ejecutarse.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/backups" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
  }'`,
        },
      ],
    },
    {
      id: 'api-restore-execute',
      navLabel: 'API: Restaurar Base',
      title: 'Endpoint REST: restaurar una copia de seguridad',
      blocks: [
        {
          type: 'paragraph',
          text: 'Restaura una copia de seguridad hacia una conexión de destino. Primero pon "isDryRun" en true para verificar la conectividad y la compatibilidad del esquema sin tocar ningún dato, y cuando estés seguro, envía la misma solicitud con ese valor en false. EnVault rechaza la solicitud de plano si la conexión de destino está marcada como producción.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/restores" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceBackupId": "3f9c2b6e-4b1a-4e9d-9c2f-1a2b3c4d5e6f",
    "targetConnectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f",
    "isDryRun": true
  }'`,
        },
      ],
    },
    {
      id: 'api-sse-telemetry',
      navLabel: 'API: Telemetría SSE',
      title: 'Progreso de restauración en vivo con Server-Sent Events',
      blocks: [
        {
          type: 'paragraph',
          text: 'Los trabajos de restauración transmiten su progreso mediante Server-Sent Events (SSE), una forma en que el servidor envía actualizaciones en vivo a tu navegador o cliente sin que tengas que consultar el estado una y otra vez. Abre el canal para el ID de un trabajo de restauración y vas recibiendo eventos a medida que avanza por cada etapa, hasta llegar a su estado final.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -N -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/restores/job_9412/stream"`,
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Los trabajos de copia de seguridad todavía no transmiten su progreso. Por ahora, consulta el endpoint de estado de copias o de trabajos para saber si uno ya terminó.',
        },
      ],
    },
    {
      id: 'api-audit-log',
      navLabel: 'API: Auditoría',
      title: 'Registro de auditoría inmutable',
      blocks: [
        {
          type: 'paragraph',
          text: 'Cada mutación (disparar una copia de seguridad, una descarga, un cambio de conexión o de credenciales, un intento de restauración) se guarda automáticamente en un registro de auditoría. Un disparador de la base de datos bloquea cualquier actualización o borrado sobre ese registro, así que ni siquiera un administrador con acceso directo a la base de datos puede reescribir la historia.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/audit?pageSize=25"`,
        },
      ],
    },
    {
      id: 'other-languages',
      navLabel: 'Otros lenguajes',
      title: 'Llamar a la API desde otros lenguajes',
      blocks: [
        {
          type: 'paragraph',
          text: 'Los ejemplos de arriba usan curl, pero EnVault expone una API REST simple, así que cualquier cliente HTTP funciona sin problema.',
        },
        { type: 'subheading', text: 'Disparar una copia de seguridad desde tu propio código' },
        {
          type: 'paragraph',
          text: 'Así se ve el mismo disparo manual de copia de seguridad escrito para un par de entornos habituales.',
        },
        {
          type: 'codeGroup',
          label: 'Disparar una copia de seguridad',
          variants: [
            {
              language: 'shell',
              label: 'curl',
              code: `curl -X POST "${API_BASE_URL_TOKEN}/backups" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"connectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f"}'`,
            },
            {
              language: 'typescript',
              label: 'TypeScript (fetch)',
              code: `const response = await fetch('${API_BASE_URL_TOKEN}/backups', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.ENVAULT_API_TOKEN}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ connectionId: 'b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f' }),
});

const job = await response.json();
console.log(job.jobId);`,
            },
            {
              language: 'python',
              label: 'Python (requests)',
              code: `import os
import requests

response = requests.post(
    "${API_BASE_URL_TOKEN}/backups",
    headers={"Authorization": f"Bearer {os.environ['ENVAULT_API_TOKEN']}"},
    json={"connectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f"},
)

job = response.json()
print(job["jobId"])`,
            },
          ],
        },
      ],
    },
    {
      id: 'scheduler-locks-guide',
      navLabel: 'Bloqueos del Planificador',
      title: 'Exclusión mutua entre réplicas',
      blocks: [
        {
          type: 'paragraph',
          text: 'Si ejecutas más de una instancia de la API por redundancia, EnVault igual corre cada trabajo programado una sola vez. Justo antes de que arranque un cronjob, una limpieza manual de retención o una restauración, la réplica que lo toma adquiere un bloqueo consultivo (advisory lock) de PostgreSQL asociado a ese trabajo y esa conexión, y lo libera en cuanto termina el trabajo, haya salido bien o mal. Cualquier otra réplica que intente tomar el mismo trabajo mientras el bloqueo está activo simplemente lo salta.',
        },
      ],
    },
    {
      id: 'retention-cleanup',
      navLabel: 'Retención y Limpieza',
      title: 'Ventanas de retención y limpieza automática',
      blocks: [
        {
          type: 'paragraph',
          text: 'Cada conexión tiene su propia ventana de retención, así que puedes conservar treinta días de copias de seguridad para una base de datos y un año para otra. Un trabajo en segundo plano revisa qué volcados ya superaron su ventana, los elimina automáticamente y libera espacio sin que tengas que intervenir.',
        },
        {
          type: 'paragraph',
          text: 'Antes de borrar algo de verdad, puedes previsualizar una limpieza para ver exactamente qué volcados eliminaría y cuánto espacio liberaría.',
        },
      ],
    },
  ],
};
