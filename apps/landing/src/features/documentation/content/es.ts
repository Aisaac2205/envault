import { API_BASE_URL_TOKEN, type DocContent } from './types';

export const es: DocContent = {
  pageTitle: 'Documentación | EnVault Management',
  pageDescription:
    'Guía práctica para registrar bases de datos, programar copias de seguridad automáticas, configurar almacenamiento en Cloudflare R2 y restaurar volcados con seguridad en EnVault Management.',
  breadcrumbLabel: 'Guía de Arquitectura y APIs',
  tocLabel: 'Tabla de contenidos',
  heroTitle: 'Documentación',
  heroSubtitle:
    'Guía técnica para desplegar y operar EnVault Management. Registra conexiones a bases de datos, programa respaldos periódicos, supervisa trabajos en tiempo real y gestiona restauraciones controladas.',
  copyCodeLabel: 'Copiar código',
  copiedLabel: '¡Copiado!',
  navGroups: [
    {
      label: 'Introducción',
      sectionIds: ['getting-started', 'architecture-overview', 'environments-guide'],
    },
    {
      label: 'Guía de Despliegue',
      sectionIds: ['deployment-docker', 'control-db-requirements', 'storage-configuration'],
    },
    {
      label: 'Seguridad y Acceso',
      sectionIds: ['auth-user-limits', 'audit-trail-observability'],
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
    {
      label: 'Operaciones & DevOps',
      sectionIds: ['scheduler-locks-guide', 'retention-cleanup'],
    },
  ],
  sections: [
    {
      id: 'getting-started',
      navLabel: 'Visión general',
      title: 'Qué hace EnVault Management',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management es una plataforma autoalojada para respaldar bases de datos y restaurarlas cuando sea necesario. Permite registrar conexiones a PostgreSQL o MySQL, programar respaldos mediante expresiones cron con zona horaria definida y monitorizar la ejecución de cada tarea directamente en el navegador. Antes de ejecutar una restauración real, es posible correr una prueba de simulación que verifica conectividad y compatibilidad de esquema sin alterar los datos existentes.',
        },
        { type: 'subheading', text: 'Requisitos de infraestructura' },
        {
          type: 'paragraph',
          text: 'EnVault Management almacena su estado interno, incluyendo conexiones registradas, programaciones, credenciales cifradas y registros de auditoría, en una base de datos de control dedicada. Dicha base de datos de control requiere PostgreSQL 16 o superior debido al uso de bloqueos consultivos nativos y columnas estructuradas en formato JSONB.',
        },
        {
          type: 'table',
          headers: ['Requisito', 'Versión', 'Propósito'],
          rows: [
            [
              'Base de datos de control',
              'PostgreSQL 16+',
              'Almacena conexiones, cronjobs, credenciales cifradas y registros de auditoría',
            ],
            [
              'Bases de datos respaldadas',
              'PostgreSQL o MySQL',
              'Instancias registradas para operaciones de volcado y restauración',
            ],
            [
              'Almacenamiento de objetos',
              'Cloudflare R2 / S3',
              'Destino donde se transmiten y resguardan los volcados mediante API compatible con S3',
            ],
          ],
        },
      ],
    },
    {
      id: 'architecture-overview',
      navLabel: 'Arquitectura',
      title: 'Aislamiento y resguardo de datos',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault mantiene su plano de control desacoplado de las bases de datos que custodia. Las credenciales de conexión se resguardan mediante cifrado autenticado AES-256-GCM antes de persistir en disco y nunca se exponen en texto plano en las respuestas del cliente.',
        },
        { type: 'subheading', text: 'Garantías operativas' },
        {
          type: 'list',
          items: [
            'Separación estricta de privilegios entre administradores y operadores.',
            'Bloqueo preventivo que prohíbe seleccionar conexiones de producción como destino de restauraciones.',
            'Bitácora inmutable en la que cada mutación operativa y evento de autenticación queda registrado sin posibilidad de borrado posterior.',
          ],
        },
      ],
    },
    {
      id: 'environments-guide',
      navLabel: 'Entornos y Segregación',
      title: 'Entornos predeterminados y modelo de segregación',
      blocks: [
        {
          type: 'paragraph',
          text: 'Toda conexión registrada en EnVault queda adscrita a uno de tres entornos estandarizados, correspondientes a producción (prod), pruebas de calidad (qa) o desarrollo (dev). Esta delimitación refleja la convención más extendida en ingeniería de software para aislar credenciales operativas y aplicar salvaguardas diferenciadas según la criticidad de la información.',
        },
        { type: 'subheading', text: 'Salvaguardas de producción' },
        {
          type: 'paragraph',
          text: 'El entorno asignado determina qué acciones son permitidas sobre cada recurso. La regla fundamental del sistema prohíbe de forma terminante que una base de datos marcada en el entorno de producción pueda recibir una restauración. Esta restricción arquitectónica impide que una equivocación manual o una automatización defectuosa sobrescriba los datos vivos de clientes.',
        },
        { type: 'subheading', text: 'Inmutabilidad actual y personalización futura' },
        {
          type: 'paragraph',
          text: 'En la versión actual del sistema, estos tres entornos son inmutables y se rigen por validación estricta en el plano de control para asegurar consistencia operativa. La evolución planificada en la hoja de ruta contempla habilitar entornos dinámicos configurables, permitiendo incorporar etiquetas como staging, uat o entornos de pruebas aislados según las necesidades de topologías organizacionales complejas.',
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
          text: 'El despliegue de EnVault y su base de datos de control PostgreSQL 16 puede realizarse mediante un archivo de composición declarativo. El volumen con nombre asegura la persistencia de las credenciales y programaciones ante reinicios de los contenedores.',
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
          text: 'El esquema de la base de datos de control se inicializa y migra de manera desatendida al arrancar el servicio por primera vez. En esta instancia residen las conexiones registradas, horarios de respaldos, credenciales cifradas y el historial inmutable de auditoría.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Conecta EnVault a una base de datos PostgreSQL exclusiva y aislada de los servidores que planeas respaldar. Mantener separada la base de control garantiza disponibilidad durante tareas de recuperación ante desastres.',
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
          text: 'Cada respaldo se transfiere directamente hacia el almacenamiento de objetos mediante flujos multipartes a medida que el proceso de volcado genera los datos. Esta técnica de streaming evita almacenar archivos temporales en el disco local del servidor, posibilitando respaldar bases de datos de gran tamaño sin saturar el almacenamiento efímero.',
        },
        {
          type: 'paragraph',
          text: 'La compatibilidad de Cloudflare R2 con el protocolo S3 permite configurar el backend suministrando el punto de enlace correspondiente, el identificador del bucket y un par de credenciales de acceso con permisos de lectura y escritura.',
        },
        {
          type: 'subheading',
          text: 'Capacidad de almacenamiento y nivel gratuito de Cloudflare R2',
        },
        {
          type: 'paragraph',
          text: 'Cloudflare R2 incluye una capa gratuita de diez gigabytes de almacenamiento al mes sin costo alguno y sin cobro por transferencia de datos saliente hacia internet. El motor de EnVault aprovecha esta infraestructura transmitiendo en fragmentos de treinta y dos megabytes, lo que permite respaldar bases de datos de hasta trescientos veinte gigabytes en una sola transmisión continua sin rebasar el límite de diez mil partes del protocolo S3. Durante las operaciones de restauración, el sistema exige un margen de seguridad en disco del veinte por ciento sobre el tamaño del archivo con un mínimo de cincuenta megabytes para impedir desbordamientos de almacenamiento local.',
        },
        {
          type: 'table',
          headers: ['Parámetro', 'Límite o cuota', 'Detalle operativo'],
          rows: [
            [
              'Capa gratuita de Cloudflare R2',
              '10 GB al mes',
              'Almacenamiento mensual incluido sin costo y con cero cargos por transferencia saliente',
            ],
            [
              'Operaciones gratuitas R2',
              '1M Clase A y 10M Clase B',
              'Operaciones de escritura y lectura mensuales incluidas sin costo',
            ],
            [
              'Tamaño máximo de objeto en R2',
              '5 TB',
              'Límite máximo por archivo individual resguardado en el bucket',
            ],
            [
              'Segmentación multipart en EnVault',
              '32 MB por parte',
              'Permite transferencias continuas de hasta 320 GB dentro del límite de diez mil partes',
            ],
            [
              'Comprobación de disco en restauración',
              'Tamaño requerido más 20%',
              'Verificación previa en almacenamiento temporal con piso mínimo de 50 MB para evitar errores ENOSPC',
            ],
          ],
        },
      ],
    },
    {
      id: 'auth-user-limits',
      navLabel: 'Autenticación y Usuarios',
      title: 'Control de acceso y límites en la creación de usuarios',
      blocks: [
        {
          type: 'paragraph',
          text: 'El acceso a la interfaz web y a las rutas protegidas se gestiona mediante un subsistema de autenticación centralizado que administra sesiones mediante cookies seguras con directivas SameSite lax y atributos httpOnly. Esta disposición impide la fuga de tokens de sesión ante scripts maliciosos en el navegador.',
        },
        { type: 'subheading', text: 'Modelo de acceso cerrado' },
        {
          type: 'paragraph',
          text: 'Por directriz de seguridad para infraestructuras empresariales, EnVault opera con registro público deshabilitado de forma intencional. La interfaz de usuario no ofrece mecanismos de autoregistro libre. El primer usuario administrador del sistema se genera de forma desatendida durante el arranque inicial mediante variables de entorno configuradas en el servidor.',
        },
        { type: 'subheading', text: 'Gestión y jerarquía de operadores' },
        {
          type: 'paragraph',
          text: 'El esquema de autorización maneja dos roles precisos, administrador y operador. Una vez completado el despliegue inicial, los administradores acreditados son los únicos autorizados para habilitar cuentas adicionales o revocar credenciales, manteniendo un perímetro de acceso restringido y verificable.',
        },
      ],
    },
    {
      id: 'audit-trail-observability',
      navLabel: 'Registro de Auditoría',
      title: 'Trazabilidad forense y registro inmutable de auditoría',
      blocks: [
        {
          type: 'paragraph',
          text: 'Toda alteración en las credenciales de conexión, creación de cronjobs, ejecuciones manuales de respaldo y eventos de inicio o cierre de sesión queda asentada de forma inmediata en la bitácora de auditoría. Un mecanismo de integridad a nivel de base de datos prohíbe operaciones de actualización o borrado en dicha tabla, garantizando una traza incorruptible.',
        },
        { type: 'subheading', text: 'Metadatos forenses capturados' },
        {
          type: 'paragraph',
          text: 'Cada registro asocia el identificador y nombre del usuario responsable, la dirección IP de origen, el agente de usuario, el método y la ruta HTTP, el entorno intervenido, la marca temporal en formato ISO, el resultado de la acción y una clasificación de severidad entre baja, media, alta y crítica.',
        },
        { type: 'subheading', text: 'Filtrado e inspección analítica' },
        {
          type: 'paragraph',
          text: 'El panel de auditoría ofrece herramientas de búsqueda que combinan criterios por usuario, entorno, tipo de recurso y ventanas de tiempo. Desde la vista detallada es posible inspeccionar cargas útiles sanitizadas, parámetros de consulta y métricas de ejecución sin comprometer contraseñas ni datos sensibles, facilitando auditorías de cumplimiento normativo como SOC 2 e ISO 27001.',
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
          text: 'Inicia un trabajo de copia de seguridad asíncrono para una conexión registrada y devuelve su identificador de trabajo de inmediato, antes de que el volcado concluya su transferencia.',
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
          text: 'Ejecuta la restauración de un volcado sobre una conexión de destino especificada. Al enviar el atributo isDryRun en true se verifica conectividad y compatibilidad de esquema sin alterar datos. Al remitir el valor en false se ejecuta la restauración real. Si la conexión de destino pertenece al entorno de producción, la solicitud es rechazada automáticamente por salvaguarda.',
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
          text: 'Los trabajos de restauración transmiten actualizaciones mediante Server-Sent Events (SSE), permitiendo recibir eventos de progreso en tiempo real sin incurrir en sondeos repetitivos. Al suscribirse al canal con el identificador del trabajo se reciben las transiciones de estado hasta la finalización del proceso.',
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
          text: 'Las copias de seguridad actualmente notifican su finalización al concluir el proceso. Para consultar el estado intermedio de un respaldo, utiliza el endpoint de consulta de trabajos.',
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
          text: 'Cada alteración en el sistema se almacena en el registro de auditoría del plano de control. El endpoint de auditoría permite consultar eventos aplicando filtros por entorno, tipo de recurso y paginación.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/audit?environment=prod&resourceType=backup&pageSize=25"`,
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
          text: 'La interfaz HTTP de EnVault sigue convenciones REST estándar, lo que permite interactuar con la plataforma utilizando cualquier biblioteca o cliente HTTP.',
        },
        { type: 'subheading', text: 'Disparar una copia de seguridad desde tu propio código' },
        {
          type: 'paragraph',
          text: 'Ejemplos de invocación del endpoint de respaldo en diversos entornos de ejecución habituales.',
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
      title: 'Exclusión mutua entre réplicas mediante bloqueos consultivos',
      blocks: [
        {
          type: 'paragraph',
          text: 'Cuando se ejecutan múltiples instancias de EnVault en paralelo para asegurar alta disponibilidad y balanceo de carga, la plataforma garantiza que cada cronjob programado, limpieza de retención y restauración se procese de forma estrictamente singular. La coordinación distribuida se apoya de forma nativa en los bloqueos consultivos de PostgreSQL, evitando la necesidad de operar motores de memoria externos adicionales.',
        },
        { type: 'subheading', text: 'Adquisición no bloqueante' },
        {
          type: 'paragraph',
          text: 'Inmediatamente antes de ejecutar una tarea, el trabajador calcula una clave numérica de 64 bits a partir del identificador de la conexión y la categoría del trabajo. Con esta clave invoca la función pg_try_advisory_lock en la base de datos de control. Si otra instancia ya adquirió el bloqueo para ese trabajo, la función responde de forma no bloqueante devolviendo false, lo que permite a la réplica omitir el ciclo sin demoras de conexión.',
        },
        { type: 'subheading', text: 'Garantías de liberación' },
        {
          type: 'paragraph',
          text: 'El bloqueo consultivo se mantiene vigente exclusivamente durante el tiempo de ejecución de la tarea y se libera mediante una rutina de cierre garantizada al concluir el trabajo, tanto si la operación finalizó con éxito como si arrojó un fallo. Ante una eventual caída del contenedor o cierre imprevisto del proceso, el motor de PostgreSQL descarta el bloqueo a nivel de sesión en el momento en que se interrumpe la conexión TCP subyacente.',
        },
      ],
    },
    {
      id: 'retention-cleanup',
      navLabel: 'Retención y Limpieza',
      title: 'Ventanas de retención y depuración automatizada',
      blocks: [
        {
          type: 'paragraph',
          text: 'Cada conexión de base de datos define su propia ventana de retención en días, permitiendo conservar siete días de respaldo para bases de datos de desarrollo y trescientos sesenta y cinco días para almacenes de producción. Un trabajador en segundo plano examina periódicamente los registros en la base de datos de control para identificar aquellos volcados cuya fecha de creación ha rebasado el periodo estipulado.',
        },
        { type: 'subheading', text: 'Depuración coordinada en dos etapas' },
        {
          type: 'paragraph',
          text: 'El proceso de purga opera en dos etapas coordinadas para garantizar que no permanezcan archivos huérfanos en la nube ni registros inconsistentes en la base de control. En primer lugar, se emite la orden de eliminación física hacia el bucket de almacenamiento de objetos, y una vez confirmada la supresión del archivo remoto, se purga el registro correspondiente en la base de datos de control.',
        },
        { type: 'subheading', text: 'Simulación previa sin impacto destructivo' },
        {
          type: 'paragraph',
          text: 'Para validar el alcance de las políticas de retención antes de aplicar cambios irreversibles, EnVault permite ejecutar limpiezas en modo de simulación. Esta operación computa las reglas configuradas y reporta la relación exacta de volcados candidatos a eliminación, sus identificadores y el volumen total de almacenamiento en bytes que se liberará, sin suprimir ningún dato del almacenamiento de objetos.',
        },
      ],
    },
  ],
};
