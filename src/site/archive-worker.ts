import { archiveDataSource, type ArchiveRequest, type ArchiveReply } from './archive-data.js';
const query = archiveDataSource();
self.addEventListener('message', async (event: MessageEvent<ArchiveRequest>) => {
  const request = event.data;
  try {
    self.postMessage({ id: request.id, result: await query(request) } satisfies ArchiveReply);
  } catch {
    self.postMessage({
      id: request.id,
      error: 'Archive filtering is unavailable.',
    } satisfies ArchiveReply);
  }
});
