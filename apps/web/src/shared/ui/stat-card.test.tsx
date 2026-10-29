import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('renders with positive trend using BadgeDot', () => {
    render(
      <StatCard label="Total" value="42" trend={{ value: 12, positive: true }} />,
    );

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    const trendEl = screen.getByText(/↑ 12%/);
    expect(trendEl).toBeInTheDocument();
    // Should NOT use the old tinted-pill class
    expect(trendEl.className).not.toContain('bg-success-bg');
  });

  it('renders with negative trend using BadgeDot', () => {
    render(
      <StatCard label="Errors" value="3" trend={{ value: 5, positive: false }} />,
    );

    const trendEl = screen.getByText(/↓ 5%/);
    expect(trendEl).toBeInTheDocument();
    expect(trendEl.className).not.toContain('bg-error-bg');
  });

  it('renders label and value directly', () => {
    render(<StatCard label="Loading" value="--" />);

    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  // jsdom ignores CSS: these pin the class contract, a browser at 360 px proves the layout.
  describe('below sm, where the card is half a phone wide', () => {
    function renderCard(props: Partial<ComponentProps<typeof StatCard>> = {}) {
      const { container } = render(
        <StatCard label="Administradores" value="12.345 MB" icon={<svg data-testid="icon" />} {...props} />,
      );
      const card = container.firstElementChild as HTMLElement;
      return {
        card,
        content: card.firstElementChild as HTMLElement,
        label: screen.getByText('Administradores'),
        icon: screen.getByTestId('icon').parentElement as HTMLElement,
        value: screen.getByText(String(props.value ?? '12.345 MB')),
      };
    }

    it('tightens the padding and the figure like the dashboard KPI card, keeping the sm+ card', () => {
      const { content, value } = renderCard();

      expect(content).toHaveClass('p-3', 'sm:p-6');
      expect(value).toHaveClass('text-2xl', 'sm:text-3xl');
      // The figure keeps its tight line at every size (tailwind-merge drops it after a text-* size).
      expect(value).toHaveClass('leading-none');
    });

    it('gives the label the icon row on a phone and shows the icon from sm', () => {
      const { icon, label } = renderCard();

      expect(icon).toHaveClass('hidden', 'sm:inline');
      // A word longer than the column breaks instead of spilling out of the card.
      expect(label).toHaveClass('max-sm:min-w-0', 'max-sm:break-words');
    });

    it('wraps the value on a phone instead of cutting it, and truncates it from sm as before', () => {
      const { value } = renderCard();

      expect(value).toHaveClass('min-w-0', 'max-sm:[overflow-wrap:anywhere]', 'sm:truncate');
      expect(value).not.toHaveClass('truncate');
      expect(value).not.toHaveClass('max-sm:line-clamp-2');
    });

    it('clamps a free-text value to two lines on a phone', () => {
      const { value } = renderCard({ value: 'orders-production-replica', truncate: true });

      expect(value).toHaveClass('max-sm:line-clamp-2', 'max-sm:[overflow-wrap:anywhere]', 'sm:truncate');
      // The clamp hides overflow: a taller line keeps the second line's descenders inside it.
      expect(value).toHaveClass('max-sm:leading-tight');
    });

    it('fills its grid cell and pins the value to the bottom, so a wrapped label never misaligns a row', () => {
      const { card, content, value } = renderCard();
      const valueRow = value.parentElement as HTMLElement;

      expect(card).toHaveClass('max-sm:h-full');
      expect(content).toHaveClass('max-sm:flex', 'max-sm:h-full', 'max-sm:flex-col');
      expect(valueRow).toHaveClass('sm:mt-3', 'max-sm:mt-auto', 'max-sm:pt-3');
      expect(valueRow).not.toHaveClass('mt-3');
    });

    it('keeps the compact figure at its size', () => {
      const { value } = renderCard({ compact: true });

      expect(value).toHaveClass('text-2xl');
      expect(value).not.toHaveClass('sm:text-3xl');
    });
  });
});
