import { t } from '../../shared/i18n.js';
import type { ChartConfig } from '../../shared/chart-schema.js';
import { validChartModules, freshChartUrl, type ChartModules } from '../../shared/chart-modules.js';
import { publicPath } from '../../shared/public-path.js';
type Controller = Awaited<ReturnType<(typeof import('./echarts-runtime.js'))['activateChart']>>;
export function enhance(node: HTMLElement, config: ChartConfig) {
  let controller: Controller | undefined, pending: Promise<Controller> | undefined;
  let pointer: { x: number; y: number } | undefined;
  let failures = 0,
    modules: ChartModules | undefined;
  const status = node.querySelector<HTMLElement>('.chart-status')!;
  const activate = (): Promise<Controller> => {
    if (controller) return Promise.resolve(controller);
    if (pending) return pending;
    node.dataset.chartLoading = 'true';
    status.textContent = t("Preparing chart controls…");
    const load = async () => {
      if (!failures) return import('./echarts-runtime.js');
      const response = await fetch(publicPath('/assets/reader-assets.json'), {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(t("Chart assets are unavailable."));
      const manifest = await response.json();
      if (
        manifest.version !== 1 ||
        !validChartModules(manifest.chartModules) ||
        !manifest.chartModules.runtime
      )
        throw new Error(t("Reload this page to retry chart controls."));
      modules = manifest.chartModules;
      return import(/* @vite-ignore */ freshChartUrl(modules!.runtime!, failures));
    };
    pending = load()
      .then(async ({ activateChart }) => {
        const active: Controller = await activateChart(node, config, modules, failures);
        controller = active;
        node.dataset.chartReady = 'true';
        delete node.dataset.chartLoading;
        if (pointer) active.pointer(pointer);
        status.textContent = config.zoom
          ? t("Ctrl + wheel to zoom. Arrow keys explore values.")
          : t("Arrow keys explore values. Shift-click a legend to isolate a series.");
        return active;
      })
      .catch((error) => {
        failures++;
        delete node.dataset.chartLoading;
        status.innerHTML = '';
        const text = document.createTextNode(
          'Interactive controls could not load. The chart and data remain available. ',
        );
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'text-link';
        retry.textContent = t("Retry");
        retry.addEventListener(
          'click',
          (event) => {
            event.stopPropagation();
            void activate().catch(() => {});
          },
          { once: true },
        );
        status.append(text, retry);
        pending = undefined;
        throw error;
      });
    return pending;
  };
  const intent = () => {
    if (!failures) void activate().catch(() => {});
  };
  node.addEventListener('pointerenter', intent, { once: true });
  node.addEventListener('focusin', intent);
  node.addEventListener('pointerdown', intent, { passive: true });
  node.querySelector('.chart-viewport')?.addEventListener('pointermove', (event) => {
    const e = event as PointerEvent;
    const r = node.querySelector('.chart-viewport')!.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  node.addEventListener('click', (event) => {
    if (failures && !controller) return;
    void activate()
      .then((c) => c.click(event))
      .catch(() => {});
  });
  node.addEventListener('keydown', (event) => {
    if (failures && !controller) return;
    if (
      (event.target as Element).closest('.chart-viewport') &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'Escape',
        'Enter',
      ].includes(event.key)
    ) {
      event.preventDefault();
      void activate()
        .then((c) => c.key(event))
        .catch(() => {});
    }
  });
  node
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      '.chart-legend button, .chart-tools button, .chart-tools input',
    )
    .forEach((c) => {
      c.disabled = false;
    });
  // Focus/pointer intent can arrive before the near-viewport loader installs listeners.
  if (node.contains(document.activeElement) || node.matches(':hover')) intent();
}
