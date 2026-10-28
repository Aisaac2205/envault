import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import i18n from "@/i18n";

/**
 * Runs the tests of the file in English (the suite defaults to Spanish). The view
 * is unmounted before the language goes back, so no mounted component re-renders
 * outside `act`.
 */
export function useEnglishLocale() {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("es");
  });
}
