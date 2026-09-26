import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import { Section, type SectionStatus } from "../Section";
import { WindowFilter } from "./WindowFilter";
import { TrendsDataTable } from "./TrendsDataTable";
import { DailyTooltipContent } from "./DailyTooltipContent";
import { OutcomePanel } from "./OutcomePanel";
import { DurationPanel } from "./DurationPanel";
import { SizePanel } from "./SizePanel";
import { useDailyAnalytics } from "../../hooks/useDailyAnalytics";
import { useKeyboardReadout } from "../../hooks/useKeyboardReadout";
import { CHART_REVEAL_SIGNATURE, revealDuration } from "../../lib/chart-layout";
import type { AnalyticsWindow } from "../../types";
import type { ChartStatus } from "@/shared/ui/charts/chart-phase";

function TrendsSkeleton() {
  return (
    <div data-testid="trends-skeleton" className="flex flex-col gap-4" aria-hidden="true">
      {[112, 88, 64].map((height) => (
        <div key={height} className="w-full animate-pulse rounded-md bg-hairline" style={{ height }} />
      ))}
    </div>
  );
}

/**
 * One frame holding the three Trends small-multiples (Outcome/Duration/Size)
 * over the same `days` — shared x-domain, one WindowFilter in the section
 * head, one accessible table, one keyboard focus stop (dashboard-page-shell
 * "Independent Section States" + Window Filter + Tooltip & Keyboard Access).
 */
export function TrendsSection() {
  const { t } = useTranslation("dashboard");
  const [windowValue, setWindowValue] = useState<AnalyticsWindow>(30);
  const { data, isLoading, isError, isPlaceholderData, refetch } = useDailyAnalytics(windowValue);
  const reducedMotion = useReducedMotion() ?? false;
  const [hasRevealed, setHasRevealed] = useState(false);

  const days = useMemo(() => data?.days ?? [], [data]);
  const { activeIndex, onKeyDown } = useKeyboardReadout(days.length);
  const activeDay = days[activeIndex];

  const status: SectionStatus = !data && isLoading ? "loading" : isError ? "error" : days.length === 0 ? "empty" : "ready";
  const chartStatus: ChartStatus = status === "loading" ? "loading" : "ready";

  // Derived-during-render (not an effect): the very first "ready" render
  // still computes `hasRevealed=false` below (so it plays the 150ms reveal),
  // then this bails React into an immediate re-render with the flag flipped
  // — before commit, no cascading post-commit render — so every later
  // render (window change, refetch) computes `hasRevealed=true` → 0ms.
  if (status === "ready" && !hasRevealed) {
    setHasRevealed(true);
  }

  // Reveal replays only on first successful mount, never on a window change
  // (design: "Never key by window") — the signature stays constant, and the
  // duration itself drops to 0 after the first reveal (or immediately under
  // reduced motion) so refetches and window switches never re-animate.
  const revealSignature = CHART_REVEAL_SIGNATURE;
  const animationDuration = revealDuration({ reducedMotion, hasRevealed });

  return (
    <Section
      id="trends"
      title={t("section.trends")}
      action={<WindowFilter value={windowValue} onChange={setWindowValue} />}
      status={status}
      skeleton={<TrendsSkeleton />}
      empty={<p className="text-sm text-muted-foreground">{t("state.empty")}</p>}
      onRetry={refetch}
      isStale={isPlaceholderData}
    >
      <div
        role="group"
        tabIndex={0}
        aria-label={t("analytics.keyboardHint")}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-4 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <OutcomePanel days={days} status={chartStatus} revealSignature={revealSignature} animationDuration={animationDuration} />
        <DurationPanel days={days} status={chartStatus} revealSignature={revealSignature} animationDuration={animationDuration} />
        <SizePanel days={days} status={chartStatus} revealSignature={revealSignature} animationDuration={animationDuration} />
        {activeDay && (
          <div className="sr-only focus-within:not-sr-only">
            <DailyTooltipContent point={activeDay} />
          </div>
        )}
      </div>
      <TrendsDataTable points={days} />
    </Section>
  );
}
