import { renderHook } from "@testing-library/react";
import { curveLinear } from "d3-shape";
import { scaleTime } from "@visx/scale";
import { describe, expect, it } from "vitest";
import {
  type UseAnimatedSeriesPathOptions,
  useAnimatedSeriesPath,
} from "./use-animated-series-path";

type Row = { date: Date; value: number | null };

function row(day: number, value: number | null): Row {
  return { date: new Date(Date.UTC(2026, 9, day)), value };
}

function subpathCount(path: string) {
  return (path.match(/M/g) ?? []).length;
}

function xScaleFrom(firstDay: number) {
  return scaleTime({
    domain: [new Date(Date.UTC(2026, 9, firstDay)), new Date(Date.UTC(2026, 9, 5))],
    range: [0, 400],
  });
}

const yScale = (value: number) => 100 - value;

function options(
  rows: Row[],
  firstDay: number,
): UseAnimatedSeriesPathOptions {
  return {
    renderData: rows,
    xAccessor: (datum) => datum.date as Date,
    xScale: xScaleFrom(firstDay) as unknown as (value: Date) => number | undefined,
    yScale,
    dataKey: "value",
    curve: curveLinear,
    chartPhase: "ready",
    durationMs: 300,
    innerWidth: 400,
    enabled: true,
  };
}

describe("useAnimatedSeriesPath", () => {
  it("tweens a domain change when the series has no gaps", () => {
    const rows = [row(1, 10), row(2, 20), row(3, 30), row(4, 40), row(5, 50)];
    const { result, rerender } = renderHook(
      (props: UseAnimatedSeriesPathOptions) => useAnimatedSeriesPath(props),
      { initialProps: options(rows, 1) },
    );
    expect(result.current.isPathAnimating).toBe(false);

    rerender(options(rows, 2));

    expect(result.current.isPathAnimating).toBe(true);
  });

  it("skips the tween and keeps the break when the series has a missing day", () => {
    const rows = [row(1, 10), row(2, 20), row(3, null), row(4, 40), row(5, 50)];
    const { result, rerender } = renderHook(
      (props: UseAnimatedSeriesPathOptions) => useAnimatedSeriesPath(props),
      { initialProps: options(rows, 1) },
    );

    rerender(options(rows, 2));

    // The data morph samples the curve and would draw through the missing day.
    expect(result.current.isPathAnimating).toBe(false);
    expect(subpathCount(result.current.pathD)).toBe(2);
  });
});
