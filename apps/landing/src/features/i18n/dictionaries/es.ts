import type { Dictionary } from '../types';

export const es: Dictionary = {
  features: {
    title: 'Copias de seguridad que simplemente funcionan, sin que tengas que estar encima',
    subtitle:
      'Sin scripts que vigilar ni listas de verificación antes de cada restauración. EnVault se encarga de tus copias de seguridad de principio a fin, para que no pierdas nada.',
    feature1Title: 'Copias de seguridad en piloto automático, incluso si escalas',
    feature1Desc:
      'Elige el horario que quieras, por hora, diario, semanal, lo que se ajuste a tu zona horaria, y olvídate del resto. Aunque tengas más de un servidor corriendo, solo uno hace la copia, así que nunca terminas con copias duplicadas.',
    feature3Title: 'Sigue cada restauración en vivo',
    feature3Desc:
      'Mira en tiempo real qué está pasando mientras se ejecuta una restauración, directo en tu navegador, sin recargar la página ni quedarte adivinando si sigue funcionando.',
    feature4Title: 'Tus copias de seguridad viven a salvo en la nube',
    feature4Desc:
      'Cada copia va directo al almacenamiento de Cloudflare. Nada queda guardado en un disco local donde se podría perder, y las copias viejas se limpian solas una vez que decides cuánto tiempo conservarlas.',
    feature5Title: 'Un registro que nadie puede alterar en silencio',
    feature5Desc:
      'Cada copia de seguridad, descarga, cambio de configuración y restauración queda registrado automáticamente. Ese registro no se puede editar ni borrar después, ni siquiera un administrador puede hacerlo. El acceso también es simple, solo hay administradores y usuarios.',
    cardIngestionSpeedLabel: 'Estado',
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
};
