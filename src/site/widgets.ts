import { t } from '../shared/i18n.js';
type Handler = { enhance: (node: HTMLElement, config: any) => void };
const loaders: Record<string, () => Promise<Handler>> = {
  quiz: () => import('./widgets/quiz.js'),
  tabs: () => import('./widgets/tabs.js'),
  'function-plot': () => import('./widgets/function-plot.js'),
  chart: () => import('./widgets/chart.js'),
  'image-compare': () => import('./widgets/image-compare.js'),
};
const pending = new WeakMap<HTMLElement, Promise<void>>();
export function enhanceWidget(node: HTMLElement): Promise<void> {
  if (node.dataset.enhanced) return Promise.resolve();
  const previous = pending.get(node);
  if (previous) return previous;
  const request = (async () => {
    const config = JSON.parse(node.dataset.config!);
    const load = Object.hasOwn(loaders, config.type) ? loaders[config.type] : undefined;
    if (!load) throw new Error(t("Unsupported interactive component."));
    const handler = await load();
    handler.enhance(node, config);
    node.dataset.enhanced = 'true';
    delete node.dataset.enhancementError;
  })().finally(() => pending.delete(node));
  pending.set(node, request);
  return request;
}
