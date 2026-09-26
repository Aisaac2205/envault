import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockChartSize, mockReducedMotion } from '@/test/chart-env';
import { Bar } from '../bar';
import { BarChart } from '../bar-chart';
import { Line } from '../line';
import { LineChart } from '../line-chart';

/**
 * dashboard-charts-web S1 gate: the vendored bklit charts mount and read
 * theming tokens without throwing. This is a smoke render, not pixel/visual
 * assertion — SVG rendering is verified by manual QA (see apply-progress).
 */
describe('vendored bklit charts (smoke)', () => {
  const barData = [
    { name: 'Mon', value: 4 },
    { name: 'Tue', value: 7 },
    { name: 'Wed', value: 2 },
  ];
  // LineChart is a time-series chart: xDataKey must resolve to a valid Date.
  const lineData = [
    { date: '2026-09-01', value: 4 },
    { date: '2026-09-02', value: 7 },
    { date: '2026-09-03', value: 2 },
  ];

  it('renders BarChart with a Bar mark', async () => {
    mockChartSize(320, 112);
    const { container } = render(
      <BarChart data={barData} height={112}>
        <Bar dataKey="value" />
      </BarChart>
    );
    await waitFor(() =>
      expect(container.querySelector('svg')).toBeInTheDocument()
    );
  });

  it('renders LineChart with a Line mark under reduced motion', async () => {
    mockChartSize(320, 88);
    mockReducedMotion(true);
    const { container } = render(
      <LineChart data={lineData}>
        <Line dataKey="value" />
      </LineChart>
    );
    await waitFor(() =>
      expect(container.querySelector('svg')).toBeInTheDocument()
    );
  });

  it('exposes an accessible fallback slot alongside the chart', () => {
    mockChartSize(320, 112);
    render(
      <div>
        <BarChart data={barData} height={112}>
          <Bar dataKey="value" />
        </BarChart>
        <table className="sr-only" aria-label="Chart data">
          <tbody>
            {barData.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    expect(screen.getByRole('table', { name: 'Chart data' })).toBeInTheDocument();
  });
});
