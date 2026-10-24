import { t } from '../shared/i18n.js';
import { analyzeSource } from './source-analysis.js';
import type { InspectionContext } from './source-inspection.js';
let context: InspectionContext | undefined,
  revision = 0;
self.onmessage = (
  event: MessageEvent<
    | { type: 'context'; revision: number; context?: InspectionContext }
    | { type: 'analyze'; id: number; source: string; contextRevision: number }
  >,
) => {
  const data = event.data;
  if (data.type === 'context') {
    context = data.context;
    revision = data.revision;
    return;
  }
  try {
    if (data.contextRevision !== revision) throw new Error(t("Stale analysis context."));
    self.postMessage({ id: data.id, result: analyzeSource(data.source, context) });
  } catch (error) {
    self.postMessage({ id: data.id, error: (error as Error).message });
  }
};
