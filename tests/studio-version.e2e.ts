import { test, expect } from '@playwright/test';

test('Studio identifies the loaded interface and keeps version details usable on narrow screens', async ({
  page,
}) => {
  await page.goto('/studio/#writing');
  const badge = page.getByRole('button', { name: /^Studio version:/ });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/v\d+\.\d+\.\d+/);
  await expect(badge.locator('code')).toHaveText(/^[a-f\d]{7}$/);
  const repository = page.getByRole('link', { name: 'Open Glass on GitHub', exact: true });
  await expect(repository).toHaveAttribute('href', 'https://github.com/Lapotron/Glass');
  await expect(repository).toHaveAttribute('target', '_blank');
  await expect(repository).toHaveAttribute('rel', 'noopener noreferrer');
  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 320)
      await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.2'));
    await expect(badge).toBeVisible();
    await expect(repository).toBeVisible();
    for (const control of await page.locator('.studio-topbar button, .studio-topbar a').all()) {
      if (!(await control.isVisible())) continue;
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await badge.click();
    const dialog = page.getByRole('dialog', { name: 'Studio version', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('code')).toHaveText(/^[a-f\d]{40,64}$/);
    await expect(dialog.getByText('Production', { exact: true })).toBeVisible();
    expect(
      Number.isFinite(Date.parse((await dialog.locator('time').getAttribute('datetime'))!)),
    ).toBe(true);
    await expect
      .poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(badge).toBeFocused();
  }
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-studio-version-mobile.png`,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--font-scale', '1');
    document.documentElement.dataset.theme = 'dark';
  });
  for (const [language, commitLabel] of [
    ['简体中文', '源代码提交'],
    ['繁體中文', '原始碼提交'],
  ]) {
    await page
      .getByRole('button', { name: /^(Interface language:|界面语言：|界面語言：)/ })
      .click();
    await page.getByRole('menuitemradio', { name: language, exact: true }).click();
    const localizedBadge = page.getByRole('button', { name: /^Studio 版本：/ });
    await localizedBadge.click();
    const details = page.getByRole('dialog', { name: 'Studio 版本', exact: true });
    await expect(details.getByText(commitLabel, { exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/visuals/${test.info().project.name}-studio-version-${language}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(localizedBadge).toBeFocused();
  }
});
