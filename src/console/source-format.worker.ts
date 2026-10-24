import { formatMarkdown } from './source-format.js';
self.onmessage = async ({
  data,
}: MessageEvent<{
  version: 1;
  id: number;
  source: string;
  selection?: { from: number; to: number };
}>) => {
  if (data.version !== 1) return;
  try {
    self.postMessage({
      version: 1,
      id: data.id,
      result: await formatMarkdown(data.source, data.selection),
    });
  } catch (error) {
    self.postMessage({ version: 1, id: data.id, error: (error as Error).message });
  }
};
