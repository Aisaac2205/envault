import { describe, expect, it } from 'vitest';
import type { Locale } from '../i18n/types';
import dashboardEs from '../../assets/dashboard/dash-es.png';
import dashboardEn from '../../assets/dashboard/dash-en.png';
import dashboardMobileEs from '../../assets/dashboard/dashmobile-es.png';
import dashboardMobileEn from '../../assets/dashboard/dashmobile-en.png';
import { getDashboardScreenshots } from './screenshots';

describe('getDashboardScreenshots', () => {
  it('returns the Spanish desktop and phone captures for "es"', () => {
    expect(getDashboardScreenshots('es')).toEqual({ desktop: dashboardEs, mobile: dashboardMobileEs });
  });

  it('returns the English desktop and phone captures for "en"', () => {
    expect(getDashboardScreenshots('en')).toEqual({ desktop: dashboardEn, mobile: dashboardMobileEn });
  });

  it('falls back to the Spanish captures for a locale it does not know', () => {
    expect(getDashboardScreenshots('fr' as Locale)).toEqual({
      desktop: dashboardEs,
      mobile: dashboardMobileEs,
    });
  });
});
