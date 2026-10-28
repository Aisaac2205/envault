import { curveLinear } from "d3-shape";
import { describe, expect, it } from "vitest";
import {
  computeSeriesPathPoints,
  seriesPathFromPoints,
} from "./series-path-utils";

const xAccessor = (d: Record<string, unknown>) => d.date as Date;
const xScale = (value: Date) => value.getTime() / 1000;
const yScale = (value: number) => 100 - value;

function row(day: number, value: number | null) {
  return { date: new Date(Date.UTC(2026, 9, day)), value };
}

function subpathCount(path: string) {
  return (path.match(/M/g) ?? []).length;
}

describe("computeSeriesPathPoints", () => {
  it("flags a missing value as undefined instead of plotting it at y 0", () => {
    const points = computeSeriesPathPoints(
      [row(1, 10), row(2, null), row(3, 30)],
      xAccessor,
      xScale,
      yScale,
      "value"
    );

    expect(points.map((point) => point.defined)).toEqual([true, false, true]);
    expect(points[0]?.y).toBe(90);
    expect(points[2]?.y).toBe(70);
  });

  it("treats a non finite number as a missing value", () => {
    const [point] = computeSeriesPathPoints(
      [row(1, Number.NaN)],
      xAccessor,
      xScale,
      yScale,
      "value"
    );

    expect(point?.defined).toBe(false);
  });
});

describe("seriesPathFromPoints", () => {
  it("breaks the line at a missing value", () => {
    const points = computeSeriesPathPoints(
      [row(1, 10), row(2, 20), row(3, null), row(4, 40), row(5, 50)],
      xAccessor,
      xScale,
      yScale,
      "value"
    );

    const path = seriesPathFromPoints(points, curveLinear);

    expect(subpathCount(path)).toBe(2);
  });

  it("keeps one continuous subpath when every value is present", () => {
    const points = computeSeriesPathPoints(
      [row(1, 10), row(2, 20), row(3, 30)],
      xAccessor,
      xScale,
      yScale,
      "value"
    );

    expect(subpathCount(seriesPathFromPoints(points, curveLinear))).toBe(1);
  });

  it("draws an isolated day between two gaps as its own subpath", () => {
    const points = computeSeriesPathPoints(
      [row(1, null), row(2, 20), row(3, null)],
      xAccessor,
      xScale,
      yScale,
      "value"
    );

    const path = seriesPathFromPoints(points, curveLinear);

    expect(subpathCount(path)).toBe(1);
    expect(path).not.toBe("");
  });

  it("draws nothing when every value is missing", () => {
    const points = computeSeriesPathPoints(
      [row(1, null), row(2, null)],
      xAccessor,
      xScale,
      yScale,
      "value"
    );

    expect(seriesPathFromPoints(points, curveLinear)).toBe("");
  });
});
