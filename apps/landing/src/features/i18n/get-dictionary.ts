import { es } from './dictionaries/es';
import { en } from './dictionaries/en';
import type { Dictionary, Locale } from './types';

const dictionaries: Record<Locale, Dictionary> = {
  es,
  en,
};

export function getDictionary(locale: Locale = 'es'): Dictionary {
  return dictionaries[locale] ?? dictionaries.es;
}
