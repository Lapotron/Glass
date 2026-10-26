import {
  archivePage,
  archiveTopics,
  createArchiveIndex,
  filterArchive,
  readArchiveCatalog,
  type ArchiveCatalog,
  type ArchivePage,
  type ArchiveState,
  type ArchiveSelection,
} from '../shared/archive.js';
import { publicAsset } from '../shared/public-path.js';
export type ArchiveRequest = {
  id: number;
  url?: string;
  embedded?: ArchiveCatalog;
  state: ArchiveState;
  page: number;
  topicQuery: string;
};
export type ArchiveResult = {
  page: ArchivePage;
  topics: { tag: string; count: number }[];
  labels: ArchiveCatalog['labels'];
};
export type ArchiveReply = { id: number; result?: ArchiveResult; error?: string };
/** Worker and offline fallback use the same index and selection, cached for pagination. */
export function archiveDataSource() {
  let loading:
    | Promise<{ index: ReturnType<typeof createArchiveIndex>; labels: ArchiveCatalog['labels'] }>
    | undefined;
  let key = '',
    selection: ArchiveSelection | undefined;
  return async (request: ArchiveRequest): Promise<ArchiveResult> => {
    loading ||= (async () => {
      let value: unknown = request.embedded;
      if (!value) {
        if (!request.url || !publicAsset(request.url, /^\/assets\/archive\/catalog-[a-f0-9]{20}\.json$/))
          throw new Error('The archive catalog is unavailable.');
        const response = await fetch(request.url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Could not load the archive catalog.');
        value = await response.json();
      }
      const catalog = readArchiveCatalog(value);
      return { index: createArchiveIndex(catalog.records, true), labels: catalog.labels };
    })().catch((error) => {
      loading = undefined;
      throw error;
    });
    const { index, labels } = await loading;
    const next = JSON.stringify(request.state);
    if (!selection || key !== next) {
      selection = filterArchive(index, request.state);
      key = next;
    }
    return {
      page: archivePage(selection, request.page),
      topics: archiveTopics(index, request.topicQuery),
      labels,
    };
  };
}
