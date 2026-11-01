import type { SiteConfig } from '../src/shared/contracts.js';
import type { DeliveryAsset } from '../src/engine/media-delivery.js';
import { digest } from '../src/engine/store.js';
import { verifyPublicMedia, type MediaTransport } from '../src/server/r2.js';
import { cloudFetch } from './cloud-client.js';

const descriptor = (asset: DeliveryAsset) => ({
  key: asset.key,
  sha256: asset.sha256,
  bytes: asset.bytes,
  contentType: asset.contentType,
});

/** CI authenticates through the existing Access service token and job-scoped bearer. */
export async function createStudioMediaTransport(
  site: SiteConfig,
  job: string,
): Promise<MediaTransport> {
  await cloudFetch('jobs/' + job + '/shared-media/begin', { method: 'POST' });
  return {
    async matches(asset) {
      const response = await cloudFetch('jobs/' + job + '/shared-media/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(descriptor(asset)),
      });
      return ((await response.json()) as { matches: boolean }).matches === true;
    },
    async upload(asset, bytes) {
      if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256)
        throw new Error('The prepared media artifact changed before upload. Build again.');
      await cloudFetch('jobs/' + job + '/shared-media/object', {
        method: 'PUT',
        headers: {
          'Content-Length': String(bytes.length),
          'Content-Type': asset.contentType,
          'X-Glass-Media': JSON.stringify(descriptor(asset)),
        },
        body: new Uint8Array(bytes),
      });
    },
    async verify(asset) {
      await verifyPublicMedia(site, asset);
    },
  };
}
