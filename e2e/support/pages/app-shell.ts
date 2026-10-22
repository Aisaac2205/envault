import type { Locator, Page } from '@playwright/test';

/**
 * The frame around every signed-in screen: sidebar, breadcrumbs and the
 * account menu. The sidebar is on screen from 768 px wide (below that it moves
 * into a drawer), which every viewport these specs use satisfies.
 */
export class AppShell {
  readonly sidebar: Locator;
  readonly sidebarLinks: Locator;
  readonly breadcrumbs: Locator;
  readonly pageHeading: Locator;
  /** The button at the foot of the sidebar; it opens the menu with the account and "Log out". */
  readonly account: Locator;

  constructor(private readonly page: Page) {
    // The sidebar is an <aside> (role "complementary"). It holds the only
    // navigation list; the breadcrumbs are a second, named navigation.
    this.sidebar = page.getByRole('complementary');
    this.sidebarLinks = this.sidebar.getByRole('navigation').getByRole('link');
    this.breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumbs' });
    this.pageHeading = page.getByRole('main').getByRole('heading', { level: 1 });
    this.account = this.sidebar.getByRole('button');
  }

  link(name: string): Locator {
    return this.sidebar.getByRole('link', { name, exact: true });
  }

  async logOut(): Promise<void> {
    await this.account.click();
    await this.page.getByRole('button', { name: 'Log out' }).click();
  }
}
