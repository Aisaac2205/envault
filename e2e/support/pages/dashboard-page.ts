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
   * The figure printed in a KPI card, found through the card's label. A KPI
   * card has no role or test id, so the value is the paragraph that follows
   * the label's row; this is the one place that depends on that layout.
   */
  kpiValue(label: string): Locator {
    // Only a paragraph counts, so a status badge that reads "Failed" never matches.
    return this.page
      .getByText(label, { exact: true })
      .and(this.page.getByRole('paragraph'))
      .locator('xpath=../following-sibling::div[1]/p[1]');
  }

  /**
   * A panel's title (for example "Backups per day" or "System health"), found as
   * plain text in a card. The chart cards render it as an h2 and the older ones
   * as a div, so this stays on text until every card has a real heading.
   */
  panelTitle(title: string): Locator {
    return this.page.getByRole('main').getByText(title, { exact: true });
  }
}
