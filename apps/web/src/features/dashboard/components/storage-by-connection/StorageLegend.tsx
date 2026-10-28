import { useMemo } from "react";
import { formatSizeMb } from "@/shared/lib/format";
import {
  Legend,
  LegendItem,
  LegendLabel,
  LegendMarker,
  LegendProgress,
  LegendValue,
  useLegendItem,
} from "@/shared/ui/charts/legend";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { formatShare, type StorageSlice } from "./storage-data";

interface StorageLegendProps {
  slices: StorageSlice[];
  total: number;
  /** The id of the slice that is pinned by click or tap, if any. */
  pinnedId: string | null;
  /** Legend index of the slice to highlight: the pinned one, or the one under the pointer. */
  highlightedIndex: number | null;
  onTogglePinned: (id: string) => void;
  onHoverChange: (index: number | null) => void;
}

interface SliceLegendItemProps {
  slices: StorageSlice[];
  pinnedId: string | null;
  onTogglePinned: (id: string) => void;
  formatPercentage: (percentage: number) => string;
}

/**
 * One legend entry: the slice marker and the connection, its size and share,
 * and a bar for the share. A real button, so a tap, a click or the keyboard pins it.
 */
function SliceLegendItem({
  slices,
  pinnedId,
  onTogglePinned,
  formatPercentage,
}: SliceLegendItemProps) {
  const { index, percentage } = useLegendItem();
  const slice = slices[index];
  if (!slice) {
    return null;
  }

  return (
    <LegendItem
      className="flex w-full min-w-0 flex-col gap-1 border border-transparent px-3 py-2 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 aria-pressed:border-text-secondary pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
      onClick={() => onTogglePinned(slice.id)}
      pressed={pinnedId === slice.id}
    >
      {/* The name gets the whole row: a long connection name is the one thing that must stay readable. */}
      <span className="flex min-w-0 items-center gap-2.5">
        <LegendMarker className="size-3" />
        <LegendLabel className="min-w-0 flex-1 truncate text-sm font-medium" />
      </span>
      {/* 22px = marker (12) + gap (10): the figures line up under the name. */}
      <span className="flex items-baseline justify-between gap-2 pl-[22px]">
        <LegendValue
          className="text-sm font-semibold tabular-nums text-legend-foreground"
          formatValue={formatSizeMb}
        />
        <span className="text-xs font-medium tabular-nums text-text-secondary">
          {formatPercentage(percentage)}
        </span>
      </span>
      <span className="block pl-[22px]">
        <LegendProgress height="h-1.5" />
      </span>
    </LegendItem>
  );
}

/**
 * The original bklit legend for the donut: marker, name, size, share and a
 * share bar. Hovering an item highlights its slice and the other way round.
 */
export function StorageLegend({
  slices,
  total,
  pinnedId,
  highlightedIndex,
  onTogglePinned,
  onHoverChange,
}: StorageLegendProps) {
  const locale = useDurationLocale();

  const items = useMemo(
    () =>
      slices.map((slice) => ({
        id: slice.id,
        label: slice.label,
        value: slice.value,
        maxValue: total,
        color: slice.color,
      })),
    [slices, total],
  );
  // The legend hands over a 0 to 100 percentage; `formatShare` wants a part and a whole.
  const formatPercentage = useMemo(
    () => (percentage: number) => formatShare(percentage, 100, locale),
    [locale],
  );

  return (
    <Legend
      className="w-full min-w-0 gap-1"
      hoveredIndex={highlightedIndex}
      items={items}
      onHoverChange={onHoverChange}
    >
      <SliceLegendItem
        formatPercentage={formatPercentage}
        onTogglePinned={onTogglePinned}
        pinnedId={pinnedId}
        slices={slices}
      />
    </Legend>
  );
}
