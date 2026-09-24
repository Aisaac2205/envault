import React from 'react';

interface RealTraceabilityCalendarProps {
  isEn?: boolean;
}

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CELL_SIZE = 10;
const CELL_GAP = 3;
const CELL_RADIUS = 2;
const STEP = CELL_SIZE + CELL_GAP;
const LEFT_OFFSET = 30;
const TOP_OFFSET = 20;
const WEEK_COUNT = 52;
const QUIET_DAY_RATE = 0.12;

const COLOR_LEVELS = [
  'var(--app-heatmap-l0)',
  'var(--app-heatmap-l1)',
  'var(--app-heatmap-l2)',
  'var(--app-heatmap-l3)',
  'var(--app-heatmap-l4)',
] as const;

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

function activityLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 7) return 2;
  if (count <= 12) return 3;
  return 4;
}

interface HeatmapCell {
  week: number;
  day: number;
  count: number;
  level: number;
}

function generateHeatmap() {
  const cells: HeatmapCell[] = [];
  let total = 0;

  for (let week = 0; week < WEEK_COUNT; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const seed = week * 7 + day + 1;
      const isWeekend = day === 0 || day === 6;
      const isSprintDay = week % 2 === 0 && !isWeekend;
      const isQuietDay = pseudoRandom(seed + 53) < (isWeekend ? QUIET_DAY_RATE * 2.2 : QUIET_DAY_RATE);

      let count = 0;

      if (!isQuietDay) {
        const scm = Math.floor(pseudoRandom(seed) > 0.6 ? pseudoRandom(seed) * 3 : 0);
        const proposals = Math.floor(pseudoRandom(seed + 977) > 0.4 ? pseudoRandom(seed + 977) * 5 : 0);
        const official = Math.floor(pseudoRandom(seed + 1613) > 0.7 ? pseudoRandom(seed + 1613) * 2 : 0);
        const runs = Math.floor(pseudoRandom(seed + 2749) > 0.3 ? pseudoRandom(seed + 2749) * 8 : 0);

        const raw = (scm + proposals + official + runs) * (isSprintDay ? 2 : 1);
        count = Math.round(raw * (isWeekend ? 0.3 : 1));
      }

      total += count;
      cells.push({ week, day, count, level: activityLevel(count) });
    }
  }

  return { cells, total };
}

const { cells: CELLS, total: TRACEABILITY_TOTAL } = generateHeatmap();

function groupThousands(value: number, separator: string): string {
  const digits = String(value);
  let grouped = '';

  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += separator;
    grouped += digits[index];
  }

  return grouped;
}

export function traceabilityTotalLabel(isEn: boolean): string {
  return groupThousands(TRACEABILITY_TOTAL, isEn ? ',' : '.');
}

export function RealTraceabilityCalendar({ isEn = false }: RealTraceabilityCalendarProps) {
  const months = isEn ? MONTHS_EN : MONTHS_ES;
  const dayLabels = isEn ? ['Mon', 'Wed', 'Fri'] : ['Lun', 'Mié', 'Vie'];

  const svgWidth = LEFT_OFFSET + WEEK_COUNT * STEP + 10;
  const svgHeight = TOP_OFFSET + 7 * STEP + 4;

  return (
    <div className="relative">
      <div className="pb-1 pt-1">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full select-none"
          role="img"
          aria-label={isEn ? 'Traceability and governance calendar' : 'Calendario de trazabilidad y gobernanza'}
        >
          {months.map((month, index) => (
            <text
              key={month}
              x={LEFT_OFFSET + Math.floor(index * 4.33) * STEP}
              y={12}
              fontSize={10}
              fill="var(--color-app-muted)"
              className="font-medium"
            >
              {month}
            </text>
          ))}

          {dayLabels.map((label, index) => (
            <text
              key={label}
              x={0}
              y={TOP_OFFSET + (index * 2 + 1) * STEP + 8}
              fontSize={9}
              fill="var(--color-app-muted)"
              className="font-medium"
            >
              {label}
            </text>
          ))}

          {CELLS.map((cell) => (
            <rect
              key={`${cell.week}-${cell.day}`}
              x={LEFT_OFFSET + cell.week * STEP}
              y={TOP_OFFSET + cell.day * STEP}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={CELL_RADIUS}
              ry={CELL_RADIUS}
              fill={COLOR_LEVELS[cell.level]}
              className="transition-all duration-100 hover:opacity-85"
            />
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-app-border/40 pt-3 text-xs text-app-muted sm:flex-row sm:items-center sm:justify-end">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span>{isEn ? 'Less' : 'Menos'}</span>
          {COLOR_LEVELS.map((color) => (
            <span
              key={color}
              aria-hidden="true"
              className="inline-block size-2.5 rounded-[2px] border border-app-border/40"
              style={{ backgroundColor: color }}
            />
          ))}
          <span>{isEn ? 'More' : 'Más'}</span>
        </div>
      </div>
    </div>
  );
}

export const TRACEABILITY_LEVEL_COLORS = COLOR_LEVELS;

export function recentTraceabilityWeeks(weekCount: number): HeatmapCell[] {
  const firstWeek = WEEK_COUNT - weekCount;

  return CELLS.filter((cell) => cell.week >= firstWeek).map((cell) => ({
    ...cell,
    week: cell.week - firstWeek,
  }));
}
