import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import esCommon from './locales/es/common.json'
import esAuth from './locales/es/auth.json'
import esDashboard from './locales/es/dashboard.json'
import esDumps from './locales/es/dumps.json'
import esCleanup from './locales/es/cleanup.json'
import esRestore from './locales/es/restore.json'
import esCronjobs from './locales/es/cronjobs.json'
import esConnections from './locales/es/connections.json'
import esUsers from './locales/es/users.json'
import esAudit from './locales/es/audit.json'
import esNotFound from './locales/es/notFound.json'

import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enDashboard from './locales/en/dashboard.json'
import enDumps from './locales/en/dumps.json'
import enCleanup from './locales/en/cleanup.json'
import enRestore from './locales/en/restore.json'
import enCronjobs from './locales/en/cronjobs.json'
import enConnections from './locales/en/connections.json'
import enUsers from './locales/en/users.json'
import enAudit from './locales/en/audit.json'
import enNotFound from './locales/en/notFound.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['es', 'en'],
    defaultNS: 'common',
    ns: [
      'common',
      'auth',
      'dashboard',
      'dumps',
      'cleanup',
      'restore',
      'cronjobs',
      'connections',
      'users',
      'audit',
      'notFound',
    ],
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    resources: {
      es: {
        common: esCommon,
        auth: esAuth,
        dashboard: esDashboard,
        dumps: esDumps,
        cleanup: esCleanup,
        restore: esRestore,
        cronjobs: esCronjobs,
        connections: esConnections,
        users: esUsers,
        audit: esAudit,
        notFound: esNotFound,
      },
      en: {
        common: enCommon,
        auth: enAuth,
        dashboard: enDashboard,
        dumps: enDumps,
        cleanup: enCleanup,
        restore: enRestore,
        cronjobs: enCronjobs,
        connections: enConnections,
        users: enUsers,
        audit: enAudit,
        notFound: enNotFound,
      },
    },
  })

export default i18n
