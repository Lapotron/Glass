import type { Page } from '@playwright/test';

/** Synthetic report tests explicitly opt into the dashboard without changing the shared notebook. */
export async function enableAnalyticsInterface(page: Page) {
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    value.site.integrations.aca = {
      ...value.site.integrations.aca,
      enabled: true,
      endpoint: 'https://aca-fixture.example',
      siteId: 'fixture',
    };
    await route.fulfill({ response, json: value });
  });
  await page.route('**/api/analytics-status', (route) =>
    route.fulfill({
      json: {
        protocol: 3,
        enabled: true,
        paused: false,
        pendingDays: 0,
        networkMode: 'daily',
      },
    }),
  );
}
