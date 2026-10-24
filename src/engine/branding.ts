import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { SiteConfig } from '../shared/contracts.js';
import { contained, digest } from './store.js';
import { fallbackFavicon } from '../shared/site-presentation.js';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { ArtifactCache, countWork } from './work-cache.js';

const implementation = fs.readFile(new URL(import.meta.url)).then(digest);

export async function writeBranding(root: string, output: string, site: SiteConfig) {
  const inputs: Buffer[] = [];
  for (const [role, reference] of [
    ['favicon', site.branding.favicon],
    ['logo', site.branding.logo],
    ['logo', site.branding.darkLogo],
  ]) {
    if (!reference) continue;
    try {
      inputs.push(
        await fs.readFile(
          await contained(
            path.join(root, 'content/media'),
            decodeURIComponent(reference.slice('/media/'.length)),
          ),
        ),
      );
    } catch {
      throw new Error(
        role === 'favicon'
          ? 'The favicon image is missing. Choose an available image in Site settings → Branding.'
          : 'A logo image is missing or cannot be decoded. Choose an available image in Site settings → Branding.',
      );
    }
  }
  const settings = JSON.stringify([site.branding, site.name, site.description, site.language]);
  const key = digest(
    JSON.stringify([await implementation, sharp.versions, settings, inputs.map(digest)]),
  );
  const cache = new ArtifactCache<{ version: string; paths: Record<string, string> }>(
    path.join(root, '.studio/render-cache/branding'),
    64 * 1024 ** 2,
  );
  const result = await cache.get(key, async () => {
    const temporary = path.join(os.tmpdir(), `glass-branding-${randomUUID()}`);
    try {
      await fs.mkdir(temporary, { recursive: true });
      countWork('branding.render');
      const version = await writeBrandingUncached(root, temporary, site);
      const files: Record<string, Buffer> = {},
        paths: Record<string, string> = {};
      for (const item of await fs.readdir(temporary, { withFileTypes: true })) {
        if (item.isDirectory()) {
          for (const name of await fs.readdir(path.join(temporary, item.name))) {
            paths[name] = `${item.name}/${name}`;
            files[name] = await fs.readFile(path.join(temporary, item.name, name));
          }
        } else {
          paths[item.name] = item.name;
          files[item.name] = await fs.readFile(path.join(temporary, item.name));
        }
      }
      return { value: { version, paths }, files };
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
  for (const [name, relative] of Object.entries(result.value.paths)) {
    const file = path.resolve(output, relative);
    if (!file.startsWith(path.resolve(output) + path.sep))
      throw new Error('Invalid cached branding path.');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, result.files[name]);
  }
  await cache.prune();
  return result.value.version;
}

function ico(images: { size: number; bytes: Buffer }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, index) => {
    const at = 6 + index * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = header[at];
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.bytes)]);
}

/** Generate small, metadata-free icons locally; readers never resize source images. */
async function writeBrandingUncached(root: string, output: string, site: SiteConfig) {
  let source: Buffer;
  try {
    source = site.branding.favicon
      ? await fs.readFile(
          await contained(
            path.join(root, 'content/media'),
            decodeURIComponent(site.branding.favicon.slice('/media/'.length)),
          ),
        )
      : Buffer.from(fallbackFavicon(site));
  } catch {
    throw new Error(
      'The favicon image is missing. Choose an available image in Site settings → Branding.',
    );
  }
  const sizes = [16, 32, 48, 64, 180, 192, 512];
  const images = new Map<number, Buffer>();
  const logos = new Map<string, Buffer>();
  try {
    for (const size of sizes)
      images.set(
        size,
        await sharp(source, { limitInputPixels: 40000000 })
          .autoOrient()
          .resize(size, size, { fit: 'contain', background: '#00000000' })
          .png()
          .toBuffer(),
      );
  } catch {
    throw new Error(
      'The favicon could not be decoded. Choose a supported raster image in Site settings → Branding.',
    );
  }
  for (const [name, reference] of [
    ['brand-logo', site.branding.logo],
    ['brand-logo-dark', site.branding.darkLogo],
  ]) {
    if (!reference) continue;
    try {
      const file = await contained(
        path.join(root, 'content/media'),
        decodeURIComponent(reference.slice('/media/'.length)),
      );
      logos.set(
        name,
        await sharp(file, { limitInputPixels: 40000000 })
          .autoOrient()
          .resize(128, 128, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer(),
      );
    } catch {
      throw new Error(
        'A logo image is missing or cannot be decoded. Choose an available image in Site settings → Branding.',
      );
    }
  }
  const version = digest(
    Buffer.concat([
      source,
      ...images.values(),
      ...logos.values(),
      Buffer.from(JSON.stringify([site.branding, site.name, site.description, site.language])),
    ]),
  ).slice(0, 16);
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  for (const [name, bytes] of logos)
    await fs.writeFile(path.join(output, 'assets', name + '.png'), bytes);
  await Promise.all([
    fs.writeFile(path.join(output, 'favicon-16x16.png'), images.get(16)!),
    fs.writeFile(path.join(output, 'favicon-32x32.png'), images.get(32)!),
    fs.writeFile(
      path.join(output, 'favicon.ico'),
      ico([16, 32, 48].map((size) => ({ size, bytes: images.get(size)! }))),
    ),
    fs.writeFile(
      path.join(output, 'apple-touch-icon.png'),
      await sharp(images.get(180)!)
        .flatten({ background: site.branding.iconBackground })
        .png()
        .toBuffer(),
    ),
    fs.writeFile(path.join(output, 'app-icon-192.png'), images.get(192)!),
    fs.writeFile(path.join(output, 'app-icon-512.png'), images.get(512)!),
    fs.writeFile(
      path.join(output, 'favicon.svg'),
      site.branding.favicon
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${images.get(64)!.toString('base64')}"/></svg>`
        : fallbackFavicon(site),
    ),
  ]);
  // A central square fits inside the maskable icon's circular safe area.
  const foreground = await sharp(source, { limitInputPixels: 40000000 })
    .autoOrient()
    .resize(280, 280, { fit: 'contain', background: '#00000000' })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: site.branding.iconBackground },
  })
    .composite([{ input: foreground, gravity: 'centre' }])
    .png()
    .toFile(path.join(output, 'app-icon-maskable.png'));
  await fs.writeFile(
    path.join(output, 'site.webmanifest'),
    JSON.stringify(
      {
        id: '/',
        name: site.name,
        short_name: site.branding.shortName || site.name,
        description: site.description,
        lang: site.language,
        start_url: '/',
        scope: '/',
        display: site.branding.appDisplay,
        theme_color: site.branding.themeColorLight,
        background_color: site.branding.appBackground,
        icons: [
          ...[192, 512].map((size) => ({
            src: `/app-icon-${size}.png?v=${version}`,
            sizes: `${size}x${size}`,
            type: 'image/png',
            purpose: 'any',
          })),
          {
            src: `/app-icon-maskable.png?v=${version}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      null,
      2,
    ),
  );
  return version;
}
