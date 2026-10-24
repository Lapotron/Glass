import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
const origin = 'http://127.0.0.1:4174';
const source = (page: Page) => page.getByRole('textbox', { name: 'Tool input', exact: true });
const output = (page: Page) => page.getByRole('textbox', { name: 'Tool output', exact: true });
async function open(page: Page, id = 'json') {
  await page.goto(`${origin}/tools/#developer/${id}`);
  await expect(page.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible();
}
async function run(page: Page) {
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.locator('[data-tools-workspace] .tools-status')).toHaveText(
    /Done\.|Ready to download\./,
  );
}

test('tool directory, Unicode transforms, validation, regex cancellation and diff remain responsive', async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link'),
  ).toHaveCount(5);
  await source(page).fill('{"message":"你好，Glass 🧪","count":3}');
  await run(page);
  await expect(output(page)).toContainText('你好，Glass 🧪');
  await source(page).fill('{oops}');
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.locator('.tools-status')).toContainText(/Expected|Invalid/);
  await page.locator('[data-tool-search]').fill('base64');
  await expect(page.locator('[data-tool-id]:visible')).toHaveCount(1);
  await page.locator('[data-tool-id="base64"]').click();
  await source(page).fill('你好 🧪');
  await run(page);
  const encoded = await output(page).innerText();
  await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('decode');
  await source(page).fill(encoded.trim());
  await run(page);
  await expect(output(page)).toHaveText('你好 🧪');
  await page.locator('[data-tool-search]').fill('');
  await page.locator('[data-tool-id="regex"]').click();
  await expect(page.getByLabel('Pattern', { exact: true })).toBeVisible();
  // Force a nonterminating worker rather than depending on engine-specific regex optimizations.
  await page.route('**/tools/developer.worker-*.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      headers: { 'Cache-Control': 'no-store' },
      body: 'self.onmessage = () => { while (true) {} };',
    }),
  );
  await page.getByLabel('Pattern', { exact: true }).fill('(a+)+$');
  await source(page).fill('a'.repeat(50_000) + '!');
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.locator('.tools-status')).toContainText('took too long');
  await page.unroute('**/tools/developer.worker-*.js');
  await page.getByLabel('Pattern', { exact: true }).fill('a+');
  await run(page);
  await expect(output(page)).toContainText('matches');
  await page.locator('[data-tool-id="diff"]').click();
  await expect(page.getByRole('textbox', { name: 'Original text', exact: true })).toBeVisible();
  await expect(page.locator('.cm-insertedLine')).not.toHaveCount(0);
  await page.getByText('Accessible comparison', { exact: true }).click();
  await expect(page.locator('.tools-diff-accessible pre').last()).toContainText('thoughtful');
});

test('all developer tools have usable controls and sensible sample outputs', async ({ page }) => {
  for (const id of [
    'json',
    'yaml',
    'csv',
    'url',
    'base64',
    'hash',
    'uuid',
    'time',
    'number',
    'text',
    'color',
  ]) {
    await open(page, id);
    if (id === 'url')
      await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('inspect');
    await run(page);
    await expect(output(page)).not.toBeEmpty();
  }
  await expect(output(page)).toContainText('contrastRatio');
  await open(page, 'jwt');
  await expect(page.locator('.tools-warning')).toContainText('unverified');
  await expect(page.getByLabel('Remember this draft', { exact: true })).toBeHidden();
});

test('draft saving is opt-in, favorites survive reload, and language changes preserve editing', async ({
  page,
}) => {
  await open(page);
  await source(page).fill('private unsaved sentinel');
  await page.reload();
  await expect(source(page)).not.toContainText('private unsaved sentinel');
  await source(page).fill('{"draft":"kept on this device"}');
  await page.getByLabel('Remember this draft', { exact: true }).check();
  await expect(page.getByText('Saved on this device.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Favorite', exact: true }).click();
  await page.reload();
  await expect(source(page)).toContainText('kept on this device');
  await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('[data-ui-menu] summary').click();
  await page.getByRole('radio', { name: '简体中文', exact: true }).check();
  await expect(page.getByRole('tab', { name: '开发者工具箱', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '工具输入', exact: true })).toContainText(
    'kept on this device',
  );
  await page.locator('[data-ui-menu] summary').click();
  await page.getByRole('radio', { name: 'English', exact: true }).check();
  await page.locator('[data-tools-clear-drafts]').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete saved drafts', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(source(page)).not.toContainText('kept on this device');
});

test('password text and binary file encryption round-trip without sending or saving content', async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') requests.push(request.postData() || '');
  });
  await open(page, 'encrypt');
  await source(page).fill('A private test message 🧪');
  await page.getByLabel('Password', { exact: true }).fill('correct test password');
  await page.getByLabel('Confirm password', { exact: true }).fill('correct test password');
  await run(page);
  const encrypted = (await output(page).innerText()).trim();
  expect(encrypted).toMatch(/^glassenc:v1:/);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
  const messageDownloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const messageFile = await messageDownloading;
  expect(messageFile.suggestedFilename()).toBe('message.glassenc');
  const messagePath = info.outputPath('message.glassenc');
  await messageFile.saveAs(messagePath);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('decrypt');
  await source(page).fill(encrypted);
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.locator('.tools-status')).toContainText('Incorrect password');
  await page.getByLabel('Password', { exact: true }).fill('correct test password');
  await run(page);
  await expect(output(page)).toHaveText('A private test message 🧪');
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('encrypt');
  await page.getByRole('combobox', { name: 'Content', exact: true }).selectOption('file');
  const original = Buffer.from([0, 1, 255, 0, 128, 4]);
  await page.getByLabel('Local file', { exact: true }).setInputFiles({
    name: 'binary-test.bin',
    mimeType: 'application/octet-stream',
    buffer: original,
  });
  await page.getByLabel('Password', { exact: true }).fill('file test password');
  await page.getByLabel('Confirm password', { exact: true }).fill('file test password');
  await run(page);
  let downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const encryptedFile = await downloading;
  const filename = info.outputPath('encrypted.glassenc');
  await encryptedFile.saveAs(filename);
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('decrypt');
  await page.getByLabel('Local file', { exact: true }).setInputFiles(filename);
  await page.getByLabel('Password', { exact: true }).fill('file test password');
  await run(page);
  downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const restored = await downloading;
  expect(restored.suggestedFilename()).toBe('binary-test.bin');
  const restoredPath = info.outputPath('restored.bin');
  await restored.saveAs(restoredPath);
  expect(await fs.readFile(restoredPath)).toEqual(original);
  await page.getByLabel('Local file', { exact: true }).setInputFiles(messagePath);
  await page.getByLabel('Password', { exact: true }).fill('correct test password');
  await run(page);
  await expect(output(page)).toHaveText('A private test message 🧪');
  expect(requests.join(' ')).not.toContain('private test message');
  await expect(page.getByLabel('Remember this draft', { exact: true })).toBeHidden();
});

test('equation intelligence, chemistry fonts, live updates and standalone image exports work', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/tools/#equation');
  await expect(page.locator('.tools-math-preview svg')).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'LaTeX source', exact: true });
  await editor.fill('\\frac{a}{b}');
  await expect(page.locator('[data-tools-equation] .tools-status')).toHaveText('Preview ready.');
  await editor.fill('\\alp');
  await editor.press('Control+Space');
  await expect(page.getByRole('option').filter({ hasText: '\\alpha' }).first()).toBeVisible();
  await expect(page.locator('.tools-math-completion svg')).toBeVisible();
  await editor.press('Escape');
  await page
    .getByRole('combobox', { name: 'Equation examples', exact: true })
    .selectOption('chemistry');
  await page.getByRole('button', { name: 'Insert example', exact: true }).click();
  await expect(page.locator('[data-tools-equation] .tools-status')).toHaveText('Preview ready.');
  await expect(page.locator('.tools-math-preview svg')).toBeVisible();
  await editor.fill('\\mathfrak{ABCDEFGHIJKLMNOPQRSTUVWXYZ} + \\mathbb{R}');
  await expect(page.locator('[data-tools-equation] .tools-status')).toHaveText('Preview ready.');
  const separator = page.getByRole('separator', { name: 'Resize equation panes' });
  await separator.focus();
  await separator.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '52');
  let downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const svg = await downloading;
  const svgPath = info.outputPath('equation.svg');
  await svg.saveAs(svgPath);
  const content = await fs.readFile(svgPath, 'utf8');
  expect(content).toContain('<svg');
  expect(content).not.toMatch(/<script|href="https?:/);
  downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const png = await downloading;
  const pngPath = info.outputPath('equation.png');
  await png.saveAs(pngPath);
  expect((await fs.readFile(pngPath)).subarray(1, 4).toString()).toBe('PNG');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value: string) => {
          (window as unknown as { mathClipboard: string }).mathClipboard = value;
        },
      },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'Copy MathML', exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { mathClipboard: string }).mathClipboard),
  ).toContain('<math');
  expect(errors).toEqual([]);
});

test('Tools stays isolated from articles and fits phones, dark mode and no-JavaScript reading', async ({
  page,
  request,
  browser,
}, info) => {
  const manifest = await (await request.get(origin + '/assets/reader-assets.json')).json();
  const home = await (await request.get(origin + '/')).text();
  expect(home).not.toContain(`src="${manifest.toolsScript}"`);
  expect(home).not.toContain(`href="${manifest.toolsStyle}"`);
  expect(home).not.toContain('/__dev/');
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto(origin + '/');
  expect(requested.some((url) => /math\.worker|developer\.worker|tools\.js/.test(url))).toBe(false);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(origin + '/tools/');
  await expect(page.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('tools-light-320.png'), fullPage: true });
  await page.locator('[data-theme-toggle]').click();
  await page.screenshot({ path: info.outputPath('tools-dark-320.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(
    page.locator('.header-tools-mobile').getByRole('link', { name: 'Tools', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.getByRole('tab', { name: 'Equation editor', exact: true }).click();
  await expect(page.locator('.tools-math-preview svg')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto(origin + '/tools/');
  await expect(plain.locator('[data-tool-id]')).toHaveCount(15);
  await expect(plain.locator('[data-tools-no-js]')).toBeVisible();
  await expect(plain.locator('[data-tools-no-js]')).toContainText('JavaScript is needed');
  await context.close();
});

test('directory scrolling keeps its glass rim fixed and Tools shortcuts use a wrench', async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await expect(page.locator('.tools-shortcut .lucide-wrench')).toBeVisible();
  const frame = page.locator('.tools-directory');
  const scroller = frame.locator('.tools-directory-scroll');
  await page.evaluate(() => {
    const frame = document.querySelector('.tools-directory')!;
    window.scrollTo({
      top: scrollY + frame.getBoundingClientRect().top - 110,
      behavior: 'instant',
    });
  });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Normalize viewport positioning after the theme control's native focus scrolling.
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    await frame.screenshot({
      path: info.outputPath(`directory-${theme}-initial.png`),
      animations: 'disabled',
    });
    const start = await frame.boundingBox();
    expect(start).not.toBeNull();
    const overflow = await scroller.evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(overflow).toBeGreaterThan(200);
    for (const [label, top] of [
      ['top', 0],
      ['middle', 180],
      ['bottom', overflow],
    ] as const) {
      await scroller.evaluate((node, top) => {
        node.scrollTop = top;
      }, top);
      expect(await scroller.evaluate((node) => node.scrollTop)).toBe(top);
      expect(await frame.evaluate((node) => node.scrollTop)).toBe(0);
      const current = await frame.boundingBox();
      expect(current!.y).toBeCloseTo(start!.y, 0);
      expect(current!.height).toBeCloseTo(start!.height, 0);
      await frame.screenshot({
        path: info.outputPath(`directory-${theme}-${label}.png`),
        animations: 'disabled',
      });
    }
  }
  await scroller.evaluate((node) => {
    node.scrollTop = 0;
  });
  const last = frame.locator('[data-tool-id="color"]');
  await last.focus();
  await expect(last).toBeFocused();
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await frame.evaluate((node) => node.scrollTop)).toBe(0);
  await page.locator('[data-tool-search]').fill('base64');
  await expect(frame.locator('[data-tool-id]:visible')).toHaveCount(1);
  await page.locator('[data-tool-search]').fill('');
  await frame.locator('[data-tool-id="base64"]').click();
  await expect(page.locator('[data-tools-workspace] h2')).toHaveText('Base64');
  await page.getByRole('button', { name: 'Favorite', exact: true }).click();
  await page.locator('[data-tool-favorites]').click();
  await expect(frame.locator('[data-tool-id]:visible')).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.locator('.header-tools-mobile .lucide-wrench')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
