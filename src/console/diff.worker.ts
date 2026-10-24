import { computeDiff } from './diff-compute.js';
self.onmessage = ({
  data,
}: MessageEvent<{ earlier: string; current: string; ignoreWhitespace: boolean }>) => {
  try {
    self.postMessage({ result: computeDiff(data.earlier, data.current, data.ignoreWhitespace) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
