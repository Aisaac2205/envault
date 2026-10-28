import { useTranslation } from "react-i18next";

/** Number formatting locale for durations, in step with the active UI language. */
export function useDurationLocale(): string {
  const { i18n } = useTranslation("dashboard");
  return i18n.language?.startsWith("en") ? "en-US" : "es-AR";
}
