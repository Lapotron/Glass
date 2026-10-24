import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { PublicEntry } from '../src/shared/contracts.js';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
const session = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, url: string, data: unknown, method = 'POST') {
  const { token } = await session(request);
  const response = await request.fetch('/api/' + url, {
    method,
    data,
    headers: { 'X-Studio-Token': token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function removeEntries(request: APIRequestContext, ids: string[]) {
  const current = (await session(request)).entries.filter((entry: any) => ids.includes(entry.id));
  if (current.length)
    await mutate(request, 'content/batch', {
      action: 'trash',
      items: current.map(({ id, revision }: any) => ({ id, revision })),
    });
  const trashed = (await (await request.get('/api/trash')).json()).filter((entry: any) =>
    ids.includes(entry.id),
  );
  if (trashed.length)
    await mutate(request, 'trash/batch', {
      action: 'purge',
      items: trashed.map(({ id, revision }: any) => ({ id, revision })),
    });
}
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
async function shot(page: Page, name: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await fs.mkdir('test-results/visuals', { recursive: true });
  await page.screenshot({
    path: path.join('test-results/visuals', `${test.info().project.name}-essentials-${name}.png`),
    fullPage: true,
  });
}

test('Writing selection supports batch tags, native export, grouped Trash undo and stale selections', async ({
  page,
  request,
}) => {
  const prefix = `Batch ${test.info().project.name}`;
  const entries: PublicEntry[] = [];
  for (let i = 0; i < 2; i++)
    entries.push(
      await mutate(request, 'content', {
        kind: 'posts',
        title: `${prefix} ${i}`,
        slug: `batch-${test.info().project.name}-${i}`,
      }),
    );
  try {
    await page.goto('/studio/#writing');
    await page.getByRole('searchbox', { name: 'Search entries' }).fill(prefix);
    await page.getByRole('checkbox', { name: 'Select ' + entries[0].title, exact: true }).check();
    expect(
      await page
        .getByRole('checkbox', { name: 'Select visible items' })
        .evaluate((node) => (node as HTMLInputElement).indeterminate),
    ).toBe(true);
    await page.getByRole('checkbox', { name: 'Select visible items' }).check();
    const actions = page.getByRole('region', { name: 'Selection actions' });
    await expect(actions).toContainText('2 selected');
    await actions.getByRole('button', { name: 'Tags', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Edit selected tags' });
    await dialog.getByRole('textbox', { name: 'Tags', exact: true }).fill('Workflow, 阅读');
    await dialog.getByRole('button', { name: 'Apply changes' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await session(request)).entries.filter(
            (entry: any) => entry.title.startsWith(prefix) && entry.tags.includes('阅读'),
          ).length,
      )
      .toBe(2);
    await page.getByRole('checkbox', { name: 'Select visible items' }).check();
    const downloadEvent = page.waitForEvent('download');
    await actions.getByRole('button', { name: 'Export Markdown' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/\.tar\.gz$/);
    expect((await fs.readFile((await download.path())!)).length).toBeGreaterThan(100);
    await actions.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Move selected entries to Trash?' });
    await dialog.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Select ' + entries[0].title, exact: true }),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'Select visible items' }).check();
    const selected = (await session(request)).entries.find(
      (entry: any) => entry.id === entries[0].id,
    );
    await mutate(
      request,
      'content/' + selected.id,
      { metadata: selected, body: 'An external edit.', revision: selected.revision },
      'PUT',
    );
    await expect(actions).toContainText('selected items changed');
    await expect(actions.getByRole('button', { name: 'Move to Trash' })).toBeHidden();
    await actions.getByRole('button', { name: 'Refresh selection' }).click();
    await expect(actions.getByRole('button', { name: 'Move to Trash' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await shot(page, 'selection-mobile');
    await page.getByRole('button', { name: 'Toggle Studio appearance' }).click();
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
    await shot(page, 'selection-mobile-dark');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shot(page, 'selection-desktop-dark');
    await page.getByRole('searchbox', { name: 'Search entries' }).fill('Different filter');
    await expect(actions).toBeHidden();
  } finally {
    await removeEntries(
      request,
      entries.map((entry) => entry.id),
    );
  }
});

test('editor duplication flushes Markdown and Trash reviews grouped restore and permanent purge', async ({
  page,
  request,
}) => {
  const prefix = `Recovery group ${test.info().project.name}`;
  const original = await mutate(request, 'content', {
    kind: 'posts',
    title: prefix + ' writing',
    slug: 'recovery-writing-' + test.info().project.name,
  });
  const lab = await mutate(request, 'content', {
    kind: 'lab',
    title: prefix + ' lab',
    slug: 'recovery-lab-' + test.info().project.name,
  });
  const ids = [original.id, lab.id];
  try {
    await page.goto('/studio/#writing');
    await page.locator('.managed-entry-open').filter({ hasText: original.title }).click();
    await page.locator('.cm-content').fill('The complete canonical Markdown survives duplication.');
    await page.getByRole('button', { name: 'Duplicate entry', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Duplicate as a draft?', exact: true })
      .getByRole('button', { name: 'Duplicate draft', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await session(request)).entries.filter(
            (entry: any) => entry.title === original.title + ' (copy)',
          ).length,
      )
      .toBe(1);
    const copied = (await session(request)).entries.find(
      (entry: any) => entry.title === original.title + ' (copy)',
    );
    ids.push(copied.id);
    expect(copied.status).toBe('draft');
    expect(copied.shortCode).not.toBe(original.shortCode);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Markdown', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    expect(await fs.readFile((await download.path())!, 'utf8')).toContain(
      'The complete canonical Markdown survives duplication.',
    );
    let current = (await session(request)).entries.filter((entry: any) => ids.includes(entry.id));
    await mutate(request, 'content/batch', {
      action: 'trash',
      items: current.map(({ id, revision }: any) => ({ id, revision })),
    });
    await page.goto('/studio/#trash');
    await page.getByRole('searchbox', { name: 'Search Trash' }).fill(prefix);
    await page.getByRole('checkbox', { name: 'Select visible items' }).check();
    await page.getByRole('button', { name: 'Restore selected', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Restore selected entries?' });
    await expect(dialog).toContainText('3 items selected');
    await dialog.getByRole('button', { name: 'Restore entries', exact: true }).click();
    await expect(dialog).toBeHidden();
    current = (await session(request)).entries.filter((entry: any) => ids.includes(entry.id));
    expect(current).toHaveLength(3);
    await mutate(request, 'content/batch', {
      action: 'trash',
      items: current.map(({ id, revision }: any) => ({ id, revision })),
    });
    await page.reload();
    await page.getByRole('searchbox', { name: 'Search Trash' }).fill(prefix);
    await page.getByRole('checkbox', { name: 'Select ' + original.title, exact: true }).check();
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Delete selected entries permanently?' });
    await expect(dialog).toContainText('retained revisions');
    await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(dialog).toBeHidden();
    const remaining = (await (await request.get('/api/trash')).json()).filter((entry: any) =>
      ids.includes(entry.id),
    );
    expect(remaining.map((entry: any) => entry.id).sort()).toEqual([lab.id, copied.id].sort());
    await page.getByRole('button', { name: 'Empty Trash', exact: true }).click();
    dialog = page.getByRole('dialog', {
      name: /Delete selected (entries|items|photos) permanently\?/,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
  } finally {
    await removeEntries(request, ids);
  }
});

test('Markdown import review creates drafts and selection survives pagination', async ({
  page,
  request,
}) => {
  const prefix = `Paging ${test.info().project.name}`,
    ids: string[] = [];
  try {
    await page.goto('/studio/#lab');
    await page.getByRole('button', { name: 'Import Markdown' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import Markdown' });
    await dialog.getByLabel('Markdown files').setInputFiles(
      Array.from({ length: 27 }, (_, i) => ({
        name: `reading-${i}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          `# ${prefix} ${String(i).padStart(2, '0')}\n\nA canonical Markdown paragraph.`,
        ),
      })),
    );
    await expect(dialog.locator('.import-review li')).toHaveCount(27);
    expect(
      (await session(request)).entries.filter((entry: any) => entry.title.startsWith(prefix)),
    ).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Import 27 drafts' }).click();
    await expect(dialog).toBeHidden();
    const imported = (await session(request)).entries.filter((entry: any) =>
      entry.title.startsWith(prefix),
    );
    ids.push(...imported.map((entry: any) => entry.id));
    expect(imported).toHaveLength(27);
    expect(imported.every((entry: any) => entry.status === 'draft')).toBe(true);
    await page.getByRole('searchbox', { name: 'Search entries' }).fill(prefix);
    await page.getByRole('checkbox', { name: 'Select visible items' }).check();
    const actions = page.getByRole('region', { name: 'Selection actions' });
    await expect(actions).toContainText('25 selected');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^Select Paging/ })).toHaveCount(2);
    await expect(actions).toContainText('25 selected');
    await actions.getByRole('button', { name: 'Select all 27 matching' }).click();
    await expect(actions).toContainText('27 selected');
    await actions.getByRole('button', { name: 'Status', exact: true }).click();
    const status = page.getByRole('dialog', { name: 'Change publication status' });
    await status.getByRole('combobox', { name: 'Publication status' }).selectOption('scheduled');
    await status.getByLabel('Publication time').fill('2030-12-31T12:00');
    await status.getByRole('button', { name: 'Apply changes' }).click();
    await expect(status).toBeHidden();
    expect(
      (await session(request)).entries
        .filter((entry: any) => ids.includes(entry.id))
        .every((entry: any) => entry.status === 'scheduled' && entry.publishAt.endsWith('Z')),
    ).toBe(true);
    await page.goto('/studio/#trash');
    await noOverflow(page);
  } finally {
    await removeEntries(
      request,
      ids.length
        ? ids
        : (await session(request)).entries
            .filter((entry: any) => entry.title.startsWith(prefix))
            .map((entry: any) => entry.id),
    );
  }
});

test('backups support labels, combined downloads and reviewed permanent deletion', async ({
  page,
  request,
}) => {
  const initial = await (await request.get('/api/backups')).json();
  const backups = [await mutate(request, 'backups', {}), await mutate(request, 'backups', {})];
  try {
    await page.goto('/studio/#backups');
    await expect(page.getByRole('switch', { name: 'Automatic daily backups' })).not.toBeChecked();
    await page
      .getByRole('checkbox', { name: 'Select backup ' + backups[0].id, exact: true })
      .check();
    await page.getByRole('button', { name: 'Rename label' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename backup label' });
    await rename.getByRole('textbox', { name: 'Backup label' }).fill('Before my next essay');
    await rename.getByRole('button', { name: 'Save label' }).click();
    await expect(rename).toBeHidden();
    await expect(page.locator('.backup-list')).toContainText('Before my next essay');
    for (const backup of backups)
      await page.getByRole('checkbox', { name: 'Select backup ' + backup.id, exact: true }).check();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download selected', exact: true }).click();
    expect((await downloadEvent).suggestedFilename()).toMatch(/\.tar\.gz$/);
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete selected backups permanently?' });
    if (!initial.length) await expect(dialog).toContainText('last saved backup');
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
    await shot(page, 'backup-review-mobile');
    await dialog.getByRole('button', { name: 'Delete backups permanently' }).click();
    await expect(dialog).toBeHidden();
    expect(
      (await (await request.get('/api/backups')).json()).filter((item: any) =>
        backups.some((backup) => backup.id === item.id),
      ),
    ).toHaveLength(0);
  } finally {
    const remaining = (await (await request.get('/api/backups')).json()).filter((item: any) =>
      backups.some((backup) => backup.id === item.id),
    );
    if (remaining.length)
      await mutate(request, 'backups/batch', {
        action: 'delete',
        items: remaining.map(({ id, revision }: any) => ({ id, revision })),
      });
  }
});

test('photo album moves and removals retain grouped undo', async ({ page, request }) => {
  const original = (await session(request)).library;
  try {
    await page.goto('/studio/#photos');
    for (const photo of original.photos.slice(0, 2))
      await page
        .getByRole('checkbox', {
          name: 'Select photo ' + (photo.caption || photo.alt),
          exact: true,
        })
        .check();
    await page.getByRole('button', { name: 'Move to album' }).click();
    const dialog = page.getByRole('dialog', { name: 'Move selected moments to an album' });
    await dialog.getByLabel('Destination album').fill('Quiet mornings');
    await dialog.getByRole('button', { name: 'Move moments' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await session(request)).library.photos.filter(
            (photo: any) => photo.album === 'Quiet mornings',
          ).length,
      )
      .toBe(2);
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect
      .poll(async () => JSON.stringify((await session(request)).library.photos))
      .toBe(JSON.stringify(original.photos));
    for (const photo of original.photos.slice(0, 2))
      await page
        .getByRole('checkbox', {
          name: 'Select photo ' + (photo.caption || photo.alt),
          exact: true,
        })
        .check();
    await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
    const remove = page.getByRole('dialog', { name: 'Remove selected moments?' });
    await remove.getByRole('button', { name: 'Remove moments' }).click();
    await expect(remove).toBeHidden();
    await expect
      .poll(async () => (await session(request)).library.photos.length)
      .toBe(original.photos.length - 2);
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect
      .poll(async () => (await session(request)).library.photos.length)
      .toBe(original.photos.length);
  } finally {
    const current = await session(request);
    if (JSON.stringify(current.library.photos) !== JSON.stringify(original.photos))
      await mutate(
        request,
        'library',
        {
          value: { ...current.library, photos: original.photos },
          revision: current.libraryRevision,
        },
        'PUT',
      );
  }
});

test('unused media deletion is reviewed, backed up and preserves in-use files', async ({
  page,
  request,
}) => {
  const { token } = await session(request);
  const bytes = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#678caa' },
  })
    .png()
    .toBuffer();
  const uploaded = await request.post('/api/media', {
    headers: { 'X-Studio-Token': token, Origin: 'http://127.0.0.1:4387' },
    multipart: {
      file: {
        name: `unused-${test.info().project.name}.png`,
        mimeType: 'image/png',
        buffer: bytes,
      },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const file = await uploaded.json();
  await page.goto('/studio/#media');
  await page.getByRole('searchbox', { name: 'Search media library' }).fill(file.name);
  await page.getByRole('combobox', { name: 'Filter media usage' }).selectOption('unused');
  await page.getByRole('checkbox', { name: 'Select media ' + file.name }).check();
  await page.getByRole('button', { name: 'Review deletion' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete unused media?' });
  await expect(dialog).toContainText('notebook safety backup');
  await dialog.getByRole('button', { name: 'Create safety backup & delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.operation-message')).toContainText('safety backup');
  expect(
    (await (await request.get('/api/media')).json()).some((item: any) => item.url === file.url),
  ).toBe(false);
  expect(
    (await (await request.get('/api/backups')).json()).some(
      (item: any) => item.reason === 'before-cleanup',
    ),
  ).toBe(true);
  const response = await request.post('/api/media/cleanup/review', {
    headers: { 'X-Studio-Token': token, Origin: 'http://127.0.0.1:4387' },
    data: { urls: ['/media/workspace.svg'] },
  });
  expect(response.ok()).toBe(false);
});

test('short links expose aliases, publication status and real Pages redirects', async ({
  page,
  request,
}) => {
  const entry = await mutate(request, 'content', {
    kind: 'lab',
    title: 'Short link browser fixture',
    slug: `short-link-${test.info().project.name}`,
  });
  try {
    await page.goto('/studio/#shortlinks');
    await page.getByRole('searchbox', { name: 'Search short links' }).fill(entry.title);
    await expect(page.locator('.shortlink-row')).toContainText('Inactive');
    await page.getByRole('button', { name: 'Edit aliases' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit short-link aliases' });
    await dialog
      .getByRole('textbox', { name: 'Custom aliases' })
      .fill('hello-' + test.info().project.name);
    await dialog.getByRole('button', { name: 'Save aliases' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.shortlink-row')).toContainText(
      '/s/hello-' + test.info().project.name,
    );
    await page.getByRole('checkbox', { name: 'Select short link ' + entry.title }).check();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export links CSV' }).click();
    expect(await fs.readFile((await (await downloadEvent).path())!, 'utf8')).toContain(
      '/s/' + entry.shortCode,
    );
    const inactive = await request.get('/s/' + entry.shortCode, { maxRedirects: 0 });
    expect(inactive.status()).toBe(404);
    const code = createHash('sha256').update('post-good-tools').digest('hex').slice(0, 12);
    for (const origin of ['http://127.0.0.1:4387', 'http://127.0.0.1:4174']) {
      const response = await request.get(origin + '/s/' + code, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toContain('/blog/good-tools-get-out-of-the-way/');
      expect(
        (await request.get(origin + '/s/' + code + '/', { maxRedirects: 0 })).status(),
      ).toBeLessThan(400);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
    await shot(page, 'shortlinks-mobile');
  } finally {
    await removeEntries(request, [entry.id]);
  }
});

test('protected email reveals only on activation and remains usable without clipboard access', async ({
  page,
  request,
  browser,
}) => {
  const { site } = await session(request);
  const address = 'reader-contact@example.org';
  const preview = await mutate(request, 'preview', {
    route: '/about/',
    site: {
      ...site,
      profile: {
        ...site.profile,
        links: site.profile.links.filter((link: any) => !link.href.startsWith('mailto:')),
        email: address,
        protectEmailLinks: true,
      },
    },
    body: '# Story\n\n[Email the author](mailto:' + address + ')',
  });
  await page.goto(preview.url);
  await expect(page.locator('body')).not.toContainText(address);
  expect(await page.locator('a[href^="mailto:"]').count()).toBe(0);
  const trigger = page.locator('.about-links [data-email-token]').first();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Email contact' });
  await expect(dialog).toContainText(address);
  await expect(dialog.getByRole('link', { name: 'Send email' })).toHaveAttribute(
    'href',
    'mailto:' + address,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await dialog.getByRole('button', { name: 'Copy address' }).click();
  await expect(dialog.getByRole('status')).toContainText('Select the address');
  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await shot(page, 'email-mobile');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const nojs = await context.newPage();
    await nojs.goto('http://127.0.0.1:4387' + preview.url);
    await expect(nojs.locator('.about-links .email-noscript')).toBeVisible();
    await expect(nojs.locator('.about-links .email-noscript')).toHaveText(
      'Enable JavaScript to reveal email.',
    );
    await expect(nojs.locator('body')).not.toContainText(address);
  } finally {
    await context.close();
  }
});

test('command palette navigates by keyboard and flushes an edited draft', async ({
  page,
  request,
}) => {
  const entry = await mutate(request, 'content', {
    kind: 'posts',
    title: 'Command palette browser fixture',
    slug: `palette-${test.info().project.name}`,
  });
  try {
    await page.goto('/studio/#writing');
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Studio commands' });
    await expect(
      dialog.getByRole('combobox', { name: 'Search commands and entries' }),
    ).toBeFocused();
    await dialog.getByRole('combobox', { name: 'Search commands and entries' }).fill(entry.title);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await page.locator('.cm-content').fill('A command palette draft saved before navigation.');
    // Source owns Cmd/Ctrl K for link composition. Studio commands remain keyboard-accessible in the header.
    await page.getByRole('button', { name: 'Open command palette', exact: true }).focus();
    await page.keyboard.press('ControlOrMeta+k');
    await dialog
      .getByRole('combobox', { name: 'Search commands and entries' })
      .fill('Manage backups');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Your notebook, kept safe.' })).toBeVisible();
    expect(
      (await session(request)).entries.find((item: any) => item.id === entry.id).body,
    ).toContain('saved before navigation');
    expect(await page.locator('dialog[open]').count()).toBe(0);
    await page.keyboard.press('ControlOrMeta+k');
    await dialog.getByRole('combobox', { name: 'Search commands and entries' }).fill('New entry');
    await page.keyboard.press('Enter');
    const draft = page.getByRole('dialog', { name: 'The start of something.' });
    await expect(draft.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
    await draft.getByRole('textbox', { name: 'Title', exact: true }).fill('A future draft');
    await draft.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await removeEntries(request, [entry.id]);
  }
});
