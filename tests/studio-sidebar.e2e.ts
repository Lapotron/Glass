import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AxeBuilder: typeof import('@axe-core/playwright').default =
  require('@axe-core/playwright').default;

async function footerFits(page: Page, status = 'Saved on this computer') {
  await expect
    .poll(() =>
      page.locator('.sidebar-footer').evaluate((footer) => {
        const bounds = footer.getBoundingClientRect();
        const sidebar = footer.closest('aside')!.getBoundingClientRect();
        const navigation = footer.parentElement!.querySelector('nav')!.getBoundingClientRect();
        return (
          bounds.top >= navigation.bottom &&
          bounds.bottom < sidebar.bottom &&
          bounds.bottom <= innerHeight &&
          bounds.left >= 0 &&
          bounds.right <= innerWidth
        );
      }),
    )
    .toBe(true);
  await expect(page.locator('.local-status')).toContainText(status);
}

async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await page.screenshot({ path: test.info().outputPath(name + '.png') });
}

for (const theme of ['light', 'dark']) {
  test(`Studio footer stays visible while short desktop navigation scrolls (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript(
      (appearance) => localStorage.setItem('fieldnotes-appearance', appearance),
      theme,
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/studio/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await footerFits(page);
    const footer = page.locator('.sidebar-footer');
    const initial = (await footer.boundingBox())!;
    const navigation = page.getByRole('navigation', { name: 'Studio navigation' });
    const backups = navigation.getByRole('button', { name: 'Backups', exact: true });
    await backups.focus();
    await expect(backups).toBeFocused();
    await expect.poll(() => navigation.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await footerFits(page);
    expect((await footer.boundingBox())!.y).toBeCloseTo(initial.y, 0);
    const trash = footer.getByRole('button', { name: 'Trash', exact: true });
    // macOS WebKit uses Option-Tab to include buttons in keyboard navigation.
    await page.keyboard.press(test.info().project.name === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(trash).toBeFocused();
    await screenshot(page, `footer-${theme}-focus`);
    await page.keyboard.press('Enter');
    await expect(trash).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'A second chance.' })).toBeVisible();
    const notebook = page.locator('.topbar-actions').getByRole('link', { name: 'View notebook' });
    await expect(notebook).toHaveAttribute('href', '/');
    await expect(notebook).toHaveAttribute('target', '_blank');
    await notebook.hover();
    await screenshot(page, `footer-${theme}-hover`);
    const audit = await new AxeBuilder({ page }).include('.sidebar-footer').analyze();
    expect(audit.violations).toEqual([]);
  });
}

for (const width of [390, 320]) {
  test(`Studio footer remains usable in the ${width}px mobile menu`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (width === 320) await page.route('**/api/events', (route) => route.abort());
    await page.goto('/studio/#writing');
    await expect(page.locator('.sidebar-footer')).toBeAttached();
    if (width === 320)
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.dataset.reduceTransparency = 'true';
        document.documentElement.style.setProperty('--font-scale', '1.2');
      });
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    const status = width === 320 ? 'Reconnecting to Studio…' : 'Saved on this computer';
    await footerFits(page, status);
    const navigation = page.getByRole('navigation', { name: 'Studio navigation' });
    await navigation.getByRole('button', { name: 'Backups', exact: true }).focus();
    await footerFits(page, status);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await screenshot(page, `footer-mobile-${width}`);
    await page
      .locator('.sidebar-footer')
      .getByRole('button', { name: 'Trash', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'A second chance.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close sidebar' })).toBeHidden();
  });
}
