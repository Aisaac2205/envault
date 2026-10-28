import type { Locator, Page } from '@playwright/test';

/** The dashboard (route "/"), located by the English copy of `locales/en/dashboard.json`. */
export class DashboardPage {
  readonly heading: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('main').getByRole('heading', { level: 1, name: 'Dashboard' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  /**
   * The figure printed in a KPI card. A card is a group named by its title and,
   * when it has one, its window spelled out ("Success rate last 30 days": the
   * visible `30d` chip is hidden from assistive technology). The figure is the
   * first paragraph in it (the caption is the second); this is the one place
   * that depends on that layout.
   */
  kpiValue(label: string): Locator {
    return this.page
      .getByRole('main')
      .getByRole('group', { name: label, exact: true })
      .getByRole('paragraph')
      .first();
  }

  /**
   * A panel's title (for example "Backup calendar" or "Connection status"), found as
   * plain text in a card. The chart cards render it as an h2 and the older ones
   * as a div, so this stays on text until every card has a real heading.
   */
  panelTitle(title: string): Locator {
    return this.page.getByRole('main').getByText(title, { exact: true });
  }
}
