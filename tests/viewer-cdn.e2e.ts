import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { cameraPicture } from './fixtures/camera.js';

const session = async (request: APIRequestContext) => (await request.get('/api/bootstrap')).json();
async function mutate(request: APIRequestContext, path: string, method: string, data: unknown) {
  const state = await session(request);
  const response = await request.fetch('/api/' + path, {
    method,
    data,
    headers: { 'X-Studio-Token': state.token, Origin: 'http://127.0.0.1:4387' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function build(request: APIRequestContext) {
  const job = await mutate(request, 'jobs', 'POST', { action: 'build' });
  await expect
    .poll(
      async () => (await session(request)).jobs.find((item: any) => item.id === job.id)?.state,
      { timeout: 20000 },
    )
    .toBe('succeeded');
}

test('viewer recovers missing CDN CORS through the published copy and preserves failure recovery', async ({
  page,
  request,
}) => {
  const before = await session(request);
  const uploaded = await request.post('/api/media', {
    headers: { 'X-Studio-Token': before.token, Origin: 'http://127.0.0.1:4387' },
    multipart: {
      file: { name: 'cors-fallback.jpg', mimeType: 'image/jpeg', buffer: await cameraPicture() },
    },
  });
  expect(uploaded.ok()).toBe(true);
  const image = await uploaded.json();
  const bytes = await (await request.get(image.url)).body();
  const cdn = 'https://media.viewer.test' + image.url;
  const entry = await mutate(request, 'content', 'POST', {
    kind: 'posts',
    title: 'CORS fallback fixture',
    slug: 'cors-fallback-' + test.info().project.name,
  });
  let cdnReads = 0,
    localReads = 0,
    unavailable = false;
  try {
    await mutate(request, 'site', 'PUT', {
      value: {
        ...before.site,
        mediaDelivery: {
          mode: 'r2',
          bucket: 'viewer-media',
          prefix: 'media',
          publicOrigin: 'https://media.viewer.test',
        },
      },
      revision: before.siteRevision,
    });
    await mutate(request, 'content/' + entry.id, 'PUT', {
      metadata: { ...entry, status: 'published', comments: false, cover: image.url },
      body: '![An image with missing CDN CORS](' + cdn + ')',
      revision: entry.revision,
    });
    await build(request);
    await page.route('**/assets/media-details.json', async (route) => {
      const data = await (await route.fetch()).json();
      data.images[image.url].url = cdn;
      await route.fulfill({ json: data });
    });
    await page.route(cdn, async (route) => {
      if (route.request().resourceType() === 'fetch') cdnReads++;
      // Explicitly deny this origin: Playwright adds permissive CORS to bare fulfill().
      await route.fulfill({
        contentType: 'image/webp',
        headers: { 'Access-Control-Allow-Origin': 'https://excluded.viewer.test' },
        body: bytes,
      });
    });
    await page.route('http://127.0.0.1:4387' + image.url, async (route) => {
      if (route.request().resourceType() === 'fetch') {
        localReads++;
        if (unavailable) return route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      }
      await route.continue();
    });
    await page.goto('/blog/' + entry.slug + '/');
    await page.evaluate(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      (window as any).revokedImageUrls = [];
      URL.revokeObjectURL = (url) => {
        (window as any).revokedImageUrls.push(url);
        revoke(url);
      };
    });
    const opener = page.locator('.article-body img');
    await opener.click();
    const viewer = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    const picture = viewer.locator('img.pswp__img').first();
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(picture).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(640);
    const blob = await picture.getAttribute('src');
    expect(cdnReads).toBe(2);
    expect(localReads).toBe(1);
    const downloading = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloading;
    await viewer.getByRole('button', { name: 'Close image viewer', exact: true }).click();
    expect(download.suggestedFilename()).toBe(image.name);
    expect(await fs.readFile((await download.path())!)).toEqual(bytes);
    await expect
      .poll(() => page.evaluate((url) => (window as any).revokedImageUrls.includes(url), blob))
      .toBe(true);
    expect(localReads).toBe(1);
    await expect(opener).toBeFocused();

    unavailable = true;
    await opener.click();
    await expect(viewer).toHaveAttribute('aria-busy', 'false');
    await expect(picture).toHaveAttribute('src', cdn);
    await viewer.getByRole('button', { name: 'Download image', exact: true }).click();
    await expect(viewer.locator('.viewer-action-status')).toContainText('Download unavailable');
    const open = viewer.getByRole('link', { name: 'Open image', exact: true });
    await expect(open).toHaveAttribute('href', cdn);
    await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    unavailable = false;
    const recovered = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download image', exact: true }).click();
    expect(await fs.readFile((await (await recovered).path())!)).toEqual(bytes);
    await viewer.getByRole('button', { name: 'Close image viewer', exact: true }).click();
    await expect(opener).toBeFocused();
  } finally {
    const current = (await session(request)).entries.find((item: any) => item.id === entry.id);
    if (current)
      await mutate(request, 'content/' + current.id, 'DELETE', { revision: current.revision });
    const latest = await session(request);
    await mutate(request, 'site', 'PUT', { value: before.site, revision: latest.siteRevision });
    await build(request);
  }
});
