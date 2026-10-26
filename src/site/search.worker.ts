import { t } from '../shared/i18n.js';
import { prepareSearch, searchEntries, type SearchEntry } from '../shared/search-index.js';
import { publicPath } from '../shared/public-path.js';
let index: Promise<ReturnType<typeof prepareSearch>> | undefined,
  latest = 0;
const load = () =>
  (index ??= fetch(publicPath('/search.json'))
    .then(async (response) => {
      if (!response.ok) throw new Error(t("Search unavailable"));
      return prepareSearch((await response.json()) as SearchEntry[]);
    })
    .catch((error) => {
      index = undefined;
      throw error;
    }));
self.onmessage = async ({ data }: MessageEvent<{ id: number; query: string }>) => {
  latest = data.id;
  try {
    const records = await load();
    if (latest === data.id)
      self.postMessage({ id: data.id, hits: searchEntries(records, data.query) });
  } catch {
    if (latest === data.id) self.postMessage({ id: data.id, error: true });
  }
};
