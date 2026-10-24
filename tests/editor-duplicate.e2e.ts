import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { promises as fs } from 'node:fs';

const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const current = await state(request);
  const response = await request.fetch('/api/' + path, {
    method,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function openEntry(page: Page, request: APIRequestContext) {
  const title = `Duplicate review ${test.info().project.name} ${test.info().line}`;
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title,
    slug: `duplicate-review-${test.info().project.name}-${test.info().line}`,
  });
  await page.goto('/studio/#writing');
  await page.locator('.managed-entry-open').filter({ hasText: title }).click();
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  return entry;
}
async function cleanup(request: APIRequestContext, ids: string[]) {
  const entries = (await state(request)).entries.filter((entry: any) => ids.includes(entry.id));
  for (const entry of entries)
    await mutate(request, `content/${entry.id}`, 'DELETE', { revision: entry.revision });
}
const duplicateDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Duplicate as a draft?', exact: true });
const duplicateButton = (page: Page) =>
  page.getByRole('button', { name: 'Duplicate entry', exact: true });
const confirmButton = (page: Page) =>
  duplicateDialog(page).getByRole('button', { name: 'Duplicate draft', exact: true });
const isDuplicate = (request: { method(): string; postDataJSON(): any }) =>
  request.method() === 'POST' && request.postDataJSON()?.action === 'duplicate';
async function shot(page: Page, name: string) {
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: `test-results/visuals/${test.info().project.name}-${name}.png`,
    animations: 'disabled',
  });
}

test('duplicate confirmation cancels without creating a copy and returns focus across themes and phone sizes', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request);
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/content/batch') && isDuplicate(request)) submissions++;
  });
  const before = (await state(request)).entries.length;
  try {
    await duplicateButton(page).click();
    const dialog = duplicateDialog(page);
    await expect(dialog).toContainText(entry.title);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await shot(page, 'editor-duplicate-light');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(duplicateButton(page)).toBeFocused();
    await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await duplicateButton(page).press('Enter');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await shot(page, 'editor-duplicate-dark');
    const audit = await new AxeBuilder({ page }).include('dialog').analyze();
    expect(audit.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(duplicateButton(page)).toBeFocused();
    await page.setViewportSize({ width: 320, height: 740 });
    await page
      .locator('html')
      .evaluate((node) => (node as HTMLElement).style.setProperty('--font-scale', '1.15'));
    await duplicateButton(page).click();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await shot(page, 'editor-duplicate-mobile');
    await page.mouse.click(1, 1);
    await expect(dialog).toHaveCount(0);
    await expect(duplicateButton(page)).toBeFocused();
    expect(submissions).toBe(0);
    expect((await state(request)).entries).toHaveLength(before);
  } finally {
    await cleanup(request, [entry.id]);
  }
});

test('confirming duplication flushes current edits and blocks duplicate submissions or dismissal while pending', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request),
    ids = [entry.id];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route('**/api/content/batch', async (route) => {
    if (isDuplicate(route.request())) {
      submissions++;
      await gate;
    }
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Article title', { exact: true }).fill(`${entry.title} updated`);
    await page.getByLabel('Article summary', { exact: true }).fill('The newest summary.');
    await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('# The newest Markdown\n\nAn unsaved thought to copy.');
    await duplicateButton(page).click();
    await expect(duplicateDialog(page)).toContainText(`${entry.title} updated`);
    await confirmButton(page).evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
    await expect.poll(() => submissions).toBe(1);
    const dialog = duplicateDialog(page);
    await expect(
      dialog.getByRole('button', { name: 'Creating draft…', exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Close Duplicate as a draft?', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.mouse.click(1, 1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
    const title = `${entry.title} updated (copy)`;
    await expect(page.locator('.editor-breadcrumb')).toContainText(title);
    const model = await state(request),
      copies = model.entries.filter((e: any) => e.title === title);
    ids.push(...copies.map((copy: any) => copy.id));
    expect(copies).toHaveLength(1);
    expect(submissions).toBe(1);
    expect(copies[0]).toMatchObject({
      status: 'draft',
      summary: 'The newest summary.',
      publishAt: '',
    });
    expect(copies[0].body).toContain('An unsaved thought to copy.');
    expect(copies[0].shortCode).not.toBe(entry.shortCode);
    expect(copies[0].id).not.toBe(entry.id);
    await expect(source).toContainText('An unsaved thought to copy.');
  } finally {
    release();
    const copies = (await state(request)).entries.filter(
      (e: any) => e.title === `${entry.title} updated (copy)`,
    );
    await cleanup(request, [...ids, ...copies.map((copy: any) => copy.id)]);
  }
});

test('invalid settings and save conflicts keep duplication blocked and retain the editor draft', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request);
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/content/batch') && isDuplicate(request)) submissions++;
  });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('URL slug', { exact: true }).fill('invalid/path');
    await duplicateButton(page).click();
    await confirmButton(page).click();
    await expect(duplicateDialog(page).getByRole('alert')).toContainText('slug');
    await duplicateDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('URL slug', { exact: true })).toHaveValue('invalid/path');
    await page.route(`**/api/content/${entry.id}`, async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Controlled external file change.' }),
        });
      else await route.continue();
    });
    await page.getByLabel('URL slug', { exact: true }).fill(entry.slug);
    await page.getByLabel('Article summary', { exact: true }).fill('Retain this unsaved summary.');
    await duplicateButton(page).click();
    await confirmButton(page).click();
    await expect(duplicateDialog(page).getByRole('alert')).toContainText(
      'Controlled external file change.',
    );
    await duplicateDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Article summary', { exact: true })).toHaveValue(
      'Retain this unsaved summary.',
    );
    expect(submissions).toBe(0);
    expect(
      (await state(request)).entries.filter((e: any) => e.title === `${entry.title} (copy)`),
    ).toHaveLength(0);
  } finally {
    await cleanup(request, [entry.id]);
  }
});

test('a failed duplicate request stays reviewable and retry creates only one draft', async ({
  page,
  request,
}) => {
  const entry = await openEntry(page, request);
  let submissions = 0;
  await page.route('**/api/content/batch', async (route) => {
    if (isDuplicate(route.request()) && ++submissions === 1)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Controlled duplication failure. Please retry.' }),
      });
    else await route.continue();
  });
  try {
    await duplicateButton(page).click();
    await confirmButton(page).click();
    await expect(duplicateDialog(page).getByRole('alert')).toHaveText(
      'Controlled duplication failure. Please retry.',
    );
    await expect(confirmButton(page)).toBeEnabled();
    expect(
      (await state(request)).entries.filter((e: any) => e.title === `${entry.title} (copy)`),
    ).toHaveLength(0);
    await shot(page, 'editor-duplicate-error');
    await confirmButton(page).click();
    await expect(duplicateDialog(page)).toHaveCount(0);
    await expect(page.locator('.editor-breadcrumb')).toContainText(`${entry.title} (copy)`);
    expect(submissions).toBe(2);
    expect(
      (await state(request)).entries.filter((e: any) => e.title === `${entry.title} (copy)`),
    ).toHaveLength(1);
  } finally {
    const copies = (await state(request)).entries.filter(
      (e: any) => e.title === `${entry.title} (copy)`,
    );
    await cleanup(request, [entry.id, ...copies.map((copy: any) => copy.id)]);
  }
});
