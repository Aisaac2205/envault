import { useCallback, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { formatSizeMb } from "@/shared/lib/format";
import { PieCenter } from "@/shared/ui/charts/pie-center";
import { PieChart } from "@/shared/ui/charts/pie-chart";
import { PieSlice } from "@/shared/ui/charts/pie-slice";
import { useCanHover } from "../dump-duration/use-can-hover";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { StorageLegend } from "./StorageLegend";
import { formatShare, type StorageSlice } from "./storage-data";

/** Diameter of the donut, hover room included, in px. It fits a 320px phone. */
export const PIE_SIZE = 192;
/** How far a hovered slice grows past the ring, in px. */
const HOVER_OFFSET = 8;
/** The hole. With the size and hover room above, the ring is 26px thick. */
const INNER_RADIUS = 62;
/** Small gap between slices, in radians, with softened corners. */
const PAD_ANGLE = 0.03;
const CORNER_RADIUS = 4;

interface StoragePieProps {
  slices: StorageSlice[];
}

/**
 * The donut and its legend. Hovering a slice or an item links the two and puts
 * that connection in the center; a tap on an item pins it. The center shows the
 * total when nothing is highlighted.
 */
export function StoragePie({ slices }: StoragePieProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const canHover = useCanHover();
  const reducedMotion = useReducedMotion();

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const total = useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices]);
  const data = useMemo(
    () => slices.map((slice) => ({ label: slice.label, value: slice.value, color: slice.color })),
    [slices],
  );

  const pinnedIndex = pinnedId ? slices.findIndex((slice) => slice.id === pinnedId) : -1;
  // The pointer wins over the pinned slice while it is over one.
  const activeIndex = hoverIndex ?? (pinnedIndex === -1 ? null : pinnedIndex);

  const togglePinned = useCallback((id: string) => {
    setPinnedId((current) => (current === id ? null : id));
    // The pointer is still over the item after a click. Without this, a second
    // click would keep the hover and look like it did nothing.
    setHoverIndex(null);
  }, []);
  // A tap fires mouse events with no mouseleave after, so on a touch screen the
  // legend reacts to taps only. The slices keep their hover: a tap there is a pin.
  const onLegendHover = useCallback(
    (index: number | null) => {
      if (canHover) {
        setHoverIndex(index);
      }
    },
    [canHover],
  );

  const summary = useMemo(
    () =>
      t("storage.chartLabel", {
        total: formatSizeMb(total),
        items: slices
          .map(
            (slice) =>
              `${slice.label} ${formatSizeMb(slice.value)} (${formatShare(slice.value, total, locale)})`,
          )
          .join(", "),
      }),
    [slices, total, locale, t],
  );

  return (
    <div className="flex w-full flex-col items-center gap-5 @sm:flex-row @sm:justify-center @sm:gap-6">
      <div aria-label={summary} className="shrink-0" role="img">
        <PieChart
          cornerRadius={CORNER_RADIUS}
          data={data}
          hoveredIndex={activeIndex}
          hoverOffset={HOVER_OFFSET}
          innerRadius={INNER_RADIUS}
          onHoverChange={setHoverIndex}
          padAngle={PAD_ANGLE}
          size={PIE_SIZE}
        >
          {slices.map((slice, index) => (
            <PieSlice
              animate={!reducedMotion}
              hoverEffect="grow"
              index={index}
              key={slice.id}
            />
          ))}
          <PieCenter defaultLabel={t("storage.total")}>
            {({ value, label }) => (
              <div className="flex max-w-full flex-col items-center gap-1 text-center">
                <span className="max-w-full truncate text-[clamp(0.875rem,15cqw,1.375rem)] font-semibold leading-none tabular-nums text-text-primary">
                  {formatSizeMb(value)}
                </span>
                <span className="max-w-full truncate text-xs text-text-secondary">{label}</span>
              </div>
            )}
          </PieCenter>
        </PieChart>
      </div>

      <div
        aria-label={t("storage.legend.label")}
        className="w-full min-w-0 @sm:max-w-72 @sm:flex-1"
        role="group"
      >
        <StorageLegend
          highlightedIndex={activeIndex}
          onHoverChange={onLegendHover}
          onTogglePinned={togglePinned}
          pinnedId={pinnedId}
          slices={slices}
          total={total}
        />
      </div>
    </div>
  );
}
