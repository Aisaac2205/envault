import { useTranslation } from "react-i18next";
import { DURATION_SERIES } from "./duration-series";
import { LineSwatch } from "./LineSwatch";

/**
 * Legend with a line sample per series (solid, dashed, dotted) next to a text
 * label, so a series is never told apart by color alone.
 */
export function DumpDurationLegend() {
  const { t } = useTranslation("dashboard");

  return (
    <ul
      aria-label={t("duration.legend.label")}
      className="flex flex-wrap items-center gap-x-5 gap-y-1.5"
      role="list"
    >
      {DURATION_SERIES.map((series) => (
        <li className="flex items-center gap-2" key={series.key}>
          <LineSwatch series={series} />
          <span className="text-xs font-medium text-text-secondary">
            {t(series.labelKey)}
          </span>
        </li>
      ))}
    </ul>
  );
}
