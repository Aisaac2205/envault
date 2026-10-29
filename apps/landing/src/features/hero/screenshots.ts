import type { ImageMetadata } from 'astro';
import type { Locale } from '../i18n/types';
import dashboardEs from '../../assets/dashboard/dash-es.png';
import dashboardEn from '../../assets/dashboard/dash-en.png';
import dashboardMobileEs from '../../assets/dashboard/dashmobile-es.png';
import dashboardMobileEn from '../../assets/dashboard/dashmobile-en.png';

/** The localized dashboard captures: the desktop browser view and the phone mockup. */
export interface DashboardScreenshots {
  desktop: ImageMetadata;
  mobile: ImageMetadata;
}

const SCREENSHOTS: Record<Locale, DashboardScreenshots> = {
  es: { desktop: dashboardEs, mobile: dashboardMobileEs },
  en: { desktop: dashboardEn, mobile: dashboardMobileEn },
};

/**
 * Single source for the dashboard captures, shared by the hero and the social preview.
 * An unknown locale falls back to Spanish, the default locale, instead of failing the build.
 */
export function getDashboardScreenshots(locale: Locale): DashboardScreenshots {
  return SCREENSHOTS[locale] ?? SCREENSHOTS.es;
}
