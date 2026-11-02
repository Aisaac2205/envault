import type { Dictionary } from '../types';

export const es: Dictionary = {
  hero: {
    title: 'Respaldos programados para PostgreSQL y MySQL',
    subtitle:
      'EnVault es una herramienta gratuita y autoalojada para respaldar PostgreSQL y MySQL, con copias programadas en tu propio bucket de Cloudflare R2. Lleva esos datos reales a tus bases de desarrollo y QA sin arriesgar la de producción.',
    installCta: 'Instalar con Docker',
    docsCta: 'Ver documentación',
    sampleDataBadge: 'Datos de ejemplo',
    screenshotAlt:
      'Panel de EnVault Management con la tasa de éxito, los respaldos de la semana, cuánto tardó cada uno y la última restauración',
  },
  backupProcess: {
    badge: 'Proceso',
    title: '¿Cómo crear una copia de seguridad de PostgreSQL y MySQL?',
    subtitle:
      'EnVault automatiza el ciclo de vida de tus respaldos en 4 pasos sencillos. Configuras tus credenciales, programas la frecuencia y restauras en entornos seguros con validación previa.',
    step1Badge: 'Paso 1',
    step1Title: 'Registra tu base de datos',
    step1Desc:
      'Indica las credenciales de tu base de datos PostgreSQL o MySQL y el entorno al que pertenece. Si es producción (PROD), queda protegida como inmutable y de solo lectura para evitar cualquier alteración desde la interfaz.',
    step2Badge: 'Paso 2',
    step2Title: 'Programa la frecuencia de respaldo',
    step2Desc:
      'Elige el horario que mejor se adapte a tu operación, diario en horas de baja carga, semanal o con una expresión cron personalizada. Un candado distribuido garantiza que nunca se generen copias duplicadas.',
    step3Badge: 'Paso 3',
    step3Title: 'Almacenamiento directo en Cloudflare R2',
    step3Desc:
      'Cada copia se transmite mediante streaming directo a tu bucket de Cloudflare R2 o compatible con S3. Los datos nunca se almacenan en el disco del servidor de EnVault y las copias antiguas se depuran solas según tu política de retención.',
    step4Badge: 'Paso 4',
    step4Title: 'Restaura a Dev o QA con simulación previa',
    step4Desc:
      'Antes de aplicar cambios reales, ejecuta una simulación (Dry Run). Podrás ver la diferencia exacta de filas y tablas entre origen y destino, desmarcar tablas específicas y confirmar con total tranquilidad sin riesgo para producción.',
  },
  features: {
    title: 'Copias de seguridad que simplemente funcionan, sin que tengas que estar encima',
    subtitle:
      'Sin scripts frágiles ni listas de verificación manuales antes de cada restauración. EnVault gestiona el ciclo completo de tus bases de datos para que tu equipo trabaje con tranquilidad.',
    feature1Title: 'Copias de seguridad en piloto automático',
    feature1Desc:
      'Elige el horario que quieras, por hora, diario, semanal o a medida, y olvídate del resto. Aunque tengas más de un servidor corriendo, solo uno hace la copia gracias al bloqueo distribuido.',
    feature3Title: 'Sigue cada restauración en vivo',
    feature3Desc:
      'Mira en tiempo real qué está pasando mientras se ejecuta una restauración, directo en tu navegador mediante eventos SSE, sin recargar la página ni quedarte con dudas.',
    feature4Title: 'Tus copias de seguridad viven a salvo en la nube',
    feature4Desc:
      'Cada copia va directo al almacenamiento de Cloudflare R2 o S3 compatible. Nada queda guardado en un disco local donde se podría perder, y las copias viejas se limpian solas según tu política de retención.',
    feature5Title: 'Un registro que nadie puede alterar en silencio',
    feature5Desc:
      'Cada copia de seguridad, descarga, cambio de configuración y restauración queda registrado automáticamente. Ese registro no se puede editar ni borrar después, ni siquiera por un administrador.',
    cardIngestionSpeedLabel: 'Estado',
    licenseTitle: 'Fair Source (FSL-1.1)',
    licenseDesc:
      'Gratuito para uso interno en empresas y proyectos de cualquier tamaño. Sin ofertas comerciales competidoras, pasando a Apache 2.0 a los dos años.',
  },
  install: {
    badge: 'Primeros pasos',
    title: '¿Cómo instalar?',
    subtitle:
      'Despliega EnVault en minutos en tu propia infraestructura, localmente o en la nube. Todo el stack queda bajo tu control.',
    tabLinux: 'Linux',
    tabWindows: 'Windows',
    tabDocker: 'Docker',
    tabCompose: 'Docker Compose',
    copyCode: 'Copiar',
    copied: '¡Copiado!',
    docsLink: 'Más sobre la instalación',
  },
  docs: {
    sectionBadge: 'Despliegue Rápido',
    title: 'Listo para correr en tu propia infraestructura',
    subtitle:
      'Despliega EnVault Management en minutos mediante Docker Compose o Railway. Control total sobre tus datos.',
    tabDocker: 'Docker Compose',
    tabApiDump: 'API: Crear Copia',
    tabApiRestore: 'API: Restaurar Base de Datos',
    copyCode: 'Copiar código',
    copied: '¡Copiado!',
  },
  footer: {
    tagline: 'La forma más simple de mantener copias de seguridad de tus bases de datos, listas para restaurar cuando las necesites.',
    systemsOperational: 'Todos los servicios operacionales',
    product: 'Producto',
    resources: 'Recursos',
    company: 'Plataforma',
    legal: 'Legal',
    rightsReserved: 'Todos los derechos reservados.',
    productLinks: {
      backups: 'Copias de seguridad',
      restore: 'Restauración Segura',
      cronjobs: 'Copias Programadas',
      auditLogs: 'Registro de Auditoría',
    },
    resourceLinks: {
      docs: 'Documentación Oficial',
      apiKeys: 'Endpoints de la API REST',
      dockerGuide: 'Guía de Docker Compose',
      githubRepo: 'Repositorio de GitHub',
    },
    companyLinks: {
      architecture: 'Arquitectura del Sistema',
      terms: 'Términos de Servicio',
      privacy: 'Política de Privacidad',
      security: 'Modelo de Seguridad',
    },
  },
  githubStar: {
    label: 'Deja una estrella en GitHub',
    starsLabel: 'estrellas',
    opensInNewTab: '(se abre en una pestaña nueva)',
  },
};
