import i18n from '@/i18n'

const getLocale = (): string => (i18n.language?.startsWith('en') ? 'en-US' : 'es-AR')

export function formatDate(date: Date | string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat(getLocale(), options ?? { dateStyle: 'medium' }).format(new Date(date))
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
}

export function formatDateTimeShort(date: Date | string | null | undefined): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatRelativeTime(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime()
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })
  if (diff < 60000) return rtf.format(-Math.floor(diff / 1000), 'second')
  if (diff < 3600000) return rtf.format(-Math.floor(diff / 60000), 'minute')
  if (diff < 86400000) return rtf.format(-Math.floor(diff / 3600000), 'hour')
  return rtf.format(-Math.floor(diff / 86400000), 'day')
}

export function formatUpcomingTime(isoDate: string): string {
  const now = new Date()
  const date = new Date(isoDate)
  const diffMs = date.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)
  const diffHr = Math.round(diffMin / 60)
  const diffDay = Math.round(diffHr / 24)

  if (diffMin <= 0) return i18n.t('time.now', { ns: 'common' })

  const locale = getLocale()

  if (diffMin < 60) return `${i18n.t('time.in', { ns: 'common' })} ${diffMin}m`
  if (diffHr < 24) return `${i18n.t('time.in', { ns: 'common' })} ${diffHr}h`

  const sameYear = date.getFullYear() === now.getFullYear()
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

  if (diffDay === 1) return `${i18n.t('time.tomorrow', { ns: 'common' })} ${time}`
  if (diffDay < 7) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${time}`
  }
  const formatted = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  return formatted + (sameYear ? '' : ` ${date.getFullYear()}`)
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`
}

export function formatNumber(n: number): string {
  return n.toLocaleString(getLocale())
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

export function nextRunParts(isoDate: string | null | undefined): { value: string; unit: string } {
  if (!isoDate) return { value: '-', unit: '' }
  const diffMs = new Date(isoDate).getTime() - Date.now()
  if (diffMs <= 0) return { value: i18n.t('time.now', { ns: 'common' }), unit: '' }
  const min = Math.round(diffMs / 60_000)
  if (min < 60) return { value: String(min), unit: 'min' }
  const h = Math.round(min / 60)
  if (h < 24) return { value: String(h), unit: 'h' }
  const d = Math.round(h / 24)
  return { value: String(d), unit: 'd' }
}

export function formatEnvironment(env: string | null | undefined): string {
  if (!env) return '-'
  const normalized = env.toLowerCase().trim()
  if (normalized === 'prod' || normalized === 'production') {
    return i18n.t('env.prod', { ns: 'common', defaultValue: 'Producción' })
  }
  if (normalized === 'dev' || normalized === 'development') {
    return i18n.t('env.dev', { ns: 'common', defaultValue: 'Desarrollo' })
  }
  if (normalized === 'qa') {
    return i18n.t('env.qa', { ns: 'common', defaultValue: 'QA' })
  }
  if (normalized === 'staging') {
    return i18n.t('env.staging', { ns: 'common', defaultValue: 'Staging' })
  }
  if (normalized === 'test' || normalized === 'testing') {
    return i18n.t('env.test', { ns: 'common', defaultValue: 'Test' })
  }
  const key = `env.${normalized}`
  return i18n.exists(key, { ns: 'common' })
    ? i18n.t(key, { ns: 'common' })
    : env.charAt(0).toUpperCase() + env.slice(1).toLowerCase()
}

