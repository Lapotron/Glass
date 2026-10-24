import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Library } from '../src/shared/contracts.js';
import type { TrashItem } from '../src/shared/operations.js';
const state = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, data: unknown, method = 'POST') {
  const current = await state(request);
  const response = await request.fetch('/api/' + path, {
    method,
    data,
    headers: { 'X-Studio-Token': current.token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function save(request: APIRequestContext, value: Library) {
  const current = await state(request);
  return mutate(request, 'library', { value, revision: current.libraryRevision }, 'PUT');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
}

test('Photo Trash keeps moments through reload, reviews conflicts, restores groups and purges selected records only', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const original = (await state(request)).library as Library;
  const prefix = `Recovered moments ${test.info().project.name}`;
  const photos = original.photos.slice(0, 2).map((photo, index) => ({
    ...photo,
    id: crypto.randomUUID(),
    caption: `${prefix} ${index + 1}`,
    album: prefix,
  }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await save(request, { ...original, photos: [...photos, ...original.photos] });
    await page.goto('/studio/#photos');
    await page.getByRole('button', { name: 'Remove ' + photos[0].caption, exact: true }).click();
    await expect(page.locator('.collection-notice')).toContainText('Moved to Trash');
    await page.getByRole('button', { name: 'Photo Trash', exact: true }).click();
    await expect(page.getByLabel('Filter Trash collection')).toHaveValue('photos');
    await page.reload();
    await page.getByLabel('Filter Trash collection').selectOption('photos');
    await page.getByRole('searchbox', { name: 'Search Trash' }).fill(prefix);
    const rows = page.locator('.trash-entry-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(photos[0].takenAt);
    await page
      .getByRole('button', { name: 'View photo ' + photos[0].caption, exact: true })
      .click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(viewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'View photo ' + photos[0].caption, exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Restore photo', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Restore selected photos?', exact: true });
    const current = await state(request);
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith('/api/bootstrap') && response.ok(),
    );
    await save(request, {
      ...current.library,
      photos: current.library.photos.map((photo: any) =>
        photo.id === photos[1].id ? { ...photo, alt: 'A later description remains intact' } : photo,
      ),
    });
    await refreshed;
    await review.getByRole('button', { name: 'Restore photos', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('photo journal changed');
    expect(
      (await state(request)).library.photos.some((photo: any) => photo.id === photos[0].id),
    ).toBe(false);
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Restore photo', exact: true }).click();
    await review.getByRole('button', { name: 'Restore photos', exact: true }).click();
    await expect(review).toBeHidden();
    await expect
      .poll(async () =>
        (await state(request)).library.photos.some((photo: any) => photo.id === photos[0].id),
      )
      .toBe(true);
    expect(
      (await state(request)).library.photos.find((photo: any) => photo.id === photos[1].id).alt,
    ).toBe('A later description remains intact');

    async function removeBoth() {
      await page.goto('/studio/#photos');
      for (const photo of photos)
        await page
          .getByRole('checkbox', { name: 'Select photo ' + photo.caption, exact: true })
          .check();
      await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
      const remove = page.getByRole('dialog', { name: 'Remove selected moments?', exact: true });
      await expect(remove).toContainText('Photo Trash');
      await remove.getByRole('button', { name: 'Remove moments', exact: true }).click();
      await expect(remove).toBeHidden();
      await page.getByRole('button', { name: 'Photo Trash', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search Trash' }).fill(prefix);
      await expect(rows).toHaveCount(2);
    }
    await removeBoth();
    await page.getByRole('checkbox', { name: 'Select visible items', exact: true }).check();
    await page.screenshot({
      path: test.info().outputPath('photo-trash-light.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Toggle Studio appearance', exact: true }).click();
    await page.screenshot({
      path: test.info().outputPath('photo-trash-dark.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 320, height: 850 });
    await noOverflow(page);
    await page.getByRole('button', { name: 'Restore selected', exact: true }).click();
    await expect(review).toContainText('2 items selected');
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath('photo-trash-phone-review.png'),
      animations: 'disabled',
    });
    await review.getByRole('button', { name: 'Restore photos', exact: true }).click();
    await expect(review).toBeHidden();
    await expect
      .poll(
        async () =>
          (await state(request)).library.photos.filter((photo: any) =>
            photos.some((item) => item.id === photo.id),
          ).length,
      )
      .toBe(2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await removeBoth();
    await page.getByRole('checkbox', { name: 'Select ' + photos[0].caption, exact: true }).check();
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    const purge = page.getByRole('dialog', {
      name: 'Delete selected photos permanently?',
      exact: true,
    });
    await expect(purge).toContainText('Image files stay in the media library');
    await purge.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(purge).toBeHidden();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(photos[1].caption);
    expect((await request.get(photos[0].src)).ok()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await save(request, original);
    const trash = ((await (await request.get('/api/trash')).json()) as TrashItem[]).filter(
      (item) => item.kind === 'photos' && photos.some((photo) => photo.id === item.photo.id),
    );
    if (trash.length)
      await mutate(request, 'trash/batch', {
        action: 'purge',
        items: trash.map(({ id, revision }) => ({ id, revision })),
      });
  }
});

test('Photo Trash has a retry when its list cannot load', async ({ page }) => {
  await page.route('**/api/trash', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Photo Trash is temporarily unavailable.' }),
    }),
  );
  await page.goto('/studio/#photos');
  await page.getByRole('button', { name: 'Photo Trash', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Empty Trash', exact: true })).toBeDisabled();
  await page.unroute('**/api/trash');
  await page.getByRole('button', { name: 'Retry loading Trash', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Trash items', exact: true })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});
