import type { CloudWorkspace } from './workspace.js';
import type { Store } from '../engine/store.js';
import { digest } from '../engine/store.js';
import { imageFile, attachmentFile } from '../shared/attachments.js';
import { effectiveMediaCode } from '../engine/media-links.js';
import { mediaDownloadName } from '../shared/media-metadata.js';
export async function cloudMedia(ws: CloudWorkspace, store: Store) {
  const { library } = await store.snapshot(),
    sources = new Map<string, { sourceId: string; width: number; height: number }>();
  for (const path of ws
    .paths()
    .filter((p) => /^\.studio\/media-originals\/[^/]+\/record\.json$/.test(p))) {
    const record = JSON.parse(new TextDecoder().decode(await ws.read(path)));
    for (const v of record.variants || [])
      sources.set(v.name, { sourceId: record.sourceId, width: v.width, height: v.height });
  }
  return [...ws.files.values()]
    .filter((f) => /^content\/media\/[^/]+$/.test(f.path))
    .filter((f) => imageFile(f.path) || attachmentFile(f.path))
    .map((file) => {
      const name = file.path.slice('content/media/'.length),
        url = '/media/' + encodeURIComponent(name),
        metadata = library.mediaDetails[url],
        source = sources.get(name);
      return {
        name,
        url,
        displayName: metadata?.displayName || name,
        downloadName: mediaDownloadName(name, metadata?.displayName),
        shortCode: effectiveMediaCode(url, library),
        publishForSharing: metadata?.publishForSharing || false,
        bytes: file.bytes,
        modifiedAt: file.modified,
        revision: digest(name + '|' + file.bytes + '|' + Date.parse(file.modified)),
        ...source,
        canEdit: !!source,
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
