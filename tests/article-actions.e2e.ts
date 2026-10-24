import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { promises as fs } from 'node:fs';
const origin = 'http://127.0.0.1:4174';
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('article actions export static QR and citations, preserve focus and recover from unavailable sharing', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await page.goto(origin + '/blog/good-tools-get-out-of-the-way/');
  const footer = page.getByRole('group', { name: 'Article details and actions' });
  await footer.scrollIntoViewIfNeeded();
  expect(requests.some((url) => url.includes('article-actions-'))).toBe(false);
  await footer.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(footer.getByRole('status')).toContainText('Clipboard is unavailable');
  await expect(footer.getByRole('textbox', { name: 'Canonical article link' })).toBeFocused();
  await expect(footer.getByRole('textbox', { name: 'Canonical article link' })).toHaveValue(
    'https://example.com/blog/good-tools-get-out-of-the-way/',
  );
  await footer.getByText('QR code', { exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Article QR code' });
  await expect(dialog.locator('svg[aria-label="QR code for this article"]')).toBeVisible();
  let download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download QR', exact: true }).click();
  expect(await fs.readFile((await (await download).path())!, 'utf8')).toContain('<svg');
  await page.keyboard.press('Escape');
  await expect(footer.locator('[data-article-dialog="qr"] > summary')).toBeFocused();
  await footer.locator('[data-article-dialog="cite"] > summary').click();
  dialog = page.getByRole('dialog', { name: 'Cite this article', exact: true });
  await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('bibtex');
  await expect(dialog.locator('[data-citation="bibtex"]')).toBeVisible();
  await expect(dialog.locator('[data-citation="plain"]')).not.toBeVisible();
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download citation', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.bib$/);
  const text = await fs.readFile((await file.path())!, 'utf8');
  expect(text).toContain('@online{');
  expect(text).toContain('https://example.com/blog/good-tools-get-out-of-the-way/');
  expect(text).not.toContain('writer@example.org');
  await dialog.getByRole('button', { name: 'Copy citation', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Select and copy');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 844 });
  await footer.scrollIntoViewIfNeeded();
  await shot(page, 'article-footer-phone');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
  await footer.locator('[data-article-dialog="cite"] > summary').click();
  dialog = page.getByRole('dialog', { name: 'Cite this article', exact: true });
  await expect(dialog).toBeVisible();
  await shot(page, 'article-citation-phone');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
  const audit = await new AxeBuilder({ page })
    .include('.article-action-dialog')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(audit.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual(
    [],
  );
  expect(requests.some((url) => /qrcode|monaco|codemirror|prettier|source-format/.test(url))).toBe(
    false,
  );
});

test('article footer works without JavaScript and private preview hides public export payloads', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(origin + '/blog/good-tools-get-out-of-the-way/');
    const footer = page.getByRole('group', { name: 'Article details and actions' });
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('link', { name: /Writer/ })).toHaveAttribute('href', '/about/');
    await footer.locator('.article-share-more > summary').click();
    await footer.getByText('QR code', { exact: true }).click();
    await expect(footer.locator('.article-qr svg')).toBeVisible();
    await footer.locator('[data-article-dialog="cite"] > summary').click();
    await expect(footer.locator('[data-citation="plain"]')).toBeVisible();
    await expect(footer.locator('[data-citation="bibtex"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
      true,
    );
    const model = await (await request.get('/api/bootstrap')).json(),
      entry = model.entries.find((e: any) => e.status === 'published');
    const response = await request.post('/api/preview', {
      headers: { 'X-Studio-Token': model.token, Origin: 'http://127.0.0.1:4387' },
      data: { entryId: entry.id, metadata: entry, body: '## Private\n\nPrivate source.' },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const result = await response.json();
    await page.goto('http://127.0.0.1:4387' + result.url);
    const privateFooter = page.locator('[data-article-footer]');
    await expect(privateFooter).toHaveAttribute('data-private', 'true');
    await expect(privateFooter).not.toHaveAttribute('data-canonical');
    await expect(privateFooter.locator('.article-qr')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('heading links animate to the target, retain history and honor reduced motion', async ({
  page,
}) => {
  await page.goto(origin + '/blog/component-showcase/');
  const link = page.locator('.post-outline [data-outline-link]').last(),
    hash = await link.getAttribute('href');
  expect(hash).toBeTruthy();
  await page.evaluate(() => {
    (window as any).headingScroll = [];
    const record = () => {
      (window as any).headingScroll.push(scrollY);
      if ((window as any).headingScroll.length < 100) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await link.click();
  await expect(page).toHaveURL(new RegExp(hash!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  const target = page.locator(hash!);
  await expect(target).toBeFocused();
  await expect
    .poll(() => target.evaluate((el) => Math.abs(el.getBoundingClientRect().top - 120)), {
      timeout: 10000,
    })
    .toBeLessThan(220);
  const samples = await page.evaluate(() => (window as any).headingScroll as number[]);
  const max = Math.max(...samples),
    min = Math.min(...samples);
  expect(samples.some((y) => y > min + 20 && y < max - 20)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(origin + '/blog/component-showcase/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await link.click();
  await expect(target).toBeFocused();
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe(
    'auto',
  );
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.site-header')).not.toBeVisible();
  await expect(page.locator('.article-footer-group').first()).not.toBeVisible();
  await expect(page.locator('[role=math] svg').first()).toBeVisible();
});
