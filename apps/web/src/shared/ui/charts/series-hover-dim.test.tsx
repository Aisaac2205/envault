import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartLegendHoverProvider } from "./chart-legend-hover";
import { SeriesHoverDim } from "./series-hover-dim";

// Only the hover slice matters here; the real one needs a whole chart around it.
const hover = vi.hoisted(() => ({
  value: { tooltipData: null as unknown, selection: null as unknown },
}));
vi.mock("./chart-context", () => ({
  useChartHover: () => hover.value,
}));

const NO_LINKING = () => undefined;
const DIMMED = 0.25;

function Series({
  testId,
  seriesIndex,
  ...props
}: {
  testId: string;
  seriesIndex: number;
  enabled?: boolean;
  dimOnChartHover?: boolean;
}) {
  return (
    <SeriesHoverDim dimOpacity={DIMMED} durationSec={0.01} seriesIndex={seriesIndex} {...props}>
      <path data-testid={testId} d="M0 0 L10 10" />
    </SeriesHoverDim>
  );
}

function renderSeries(
  children: React.ReactNode,
  { legendIndex }: { legendIndex: number | null } = { legendIndex: null },
) {
  return render(
    <ChartLegendHoverProvider hoveredIndex={legendIndex} onHoverChange={NO_LINKING}>
      <svg>{children}</svg>
    </ChartLegendHoverProvider>,
  );
}

/** Opacity of the group that wraps a series; motion writes it as an SVG attribute. */
function opacityOf(container: HTMLElement, testId: string): number {
  const group = container.querySelector(`[data-testid="${testId}"]`)?.closest("g");
  return Number(group?.getAttribute("opacity") ?? 1);
}

describe("SeriesHoverDim", () => {
  beforeEach(() => {
    hover.value = { tooltipData: null, selection: null };
  });

  it("dims the other series while the legend emphasizes one", async () => {
    const { container } = renderSeries(
      <>
        <Series seriesIndex={0} testId="p50" />
        <Series seriesIndex={1} testId="p95" />
      </>,
      { legendIndex: 1 },
    );

    await waitFor(() => expect(opacityOf(container, "p50")).toBe(DIMMED));
    expect(opacityOf(container, "p95")).toBe(1);
  });

  it("dims on chart hover by default", async () => {
    hover.value = { tooltipData: { index: 3 }, selection: null };

    const { container } = renderSeries(<Series seriesIndex={0} testId="p50" />);

    await waitFor(() => expect(opacityOf(container, "p50")).toBe(DIMMED));
  });

  it("does not dim anything when enabled is false, even with legend emphasis and chart hover", async () => {
    hover.value = { tooltipData: { index: 3 }, selection: null };

    const { container } = renderSeries(
      <>
        {/* The control: the same setup, enabled, does dim. */}
        <Series seriesIndex={0} testId="control" />
        <Series enabled={false} seriesIndex={0} testId="disabled" />
      </>,
      { legendIndex: 1 },
    );

    await waitFor(() => expect(opacityOf(container, "control")).toBe(DIMMED));
    expect(opacityOf(container, "disabled")).toBe(1);
  });

  it("keeps the legend emphasis but ignores the chart hover when dimOnChartHover is false", async () => {
    hover.value = { tooltipData: { index: 3 }, selection: null };

    const { container, rerender } = renderSeries(
      <Series dimOnChartHover={false} seriesIndex={0} testId="p50" />,
    );

    // Chart hover alone: nothing dims. The legend case below proves the wait is long enough.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(opacityOf(container, "p50")).toBe(1);

    rerender(
      <ChartLegendHoverProvider hoveredIndex={1} onHoverChange={NO_LINKING}>
        <svg>
          <Series dimOnChartHover={false} seriesIndex={0} testId="p50" />
        </svg>
      </ChartLegendHoverProvider>,
    );

    await waitFor(() => expect(opacityOf(container, "p50")).toBe(DIMMED));
  });

  it("also dims while a brush selection is active", async () => {
    hover.value = { tooltipData: null, selection: { active: true } };

    const { container } = renderSeries(<Series seriesIndex={0} testId="p50" />);

    await waitFor(() => expect(opacityOf(container, "p50")).toBe(DIMMED));
  });
});
