import { t } from '../../shared/i18n.js';
import type { ECharts } from 'echarts/core';
import { chartOptions, chartLegend, cartesianChart } from '../../shared/chart-options.js';
import { chartRows, chartPointLabel, chartCsv } from '../../shared/chart-data.js';
import type { ChartConfig } from '../../shared/chart-schema.js';
import { freshChartUrl, type ChartModules } from '../../shared/chart-modules.js';

const family = (c: ChartConfig) =>
  cartesianChart(c)
    ? import('./echarts-cartesian.js')
    : ['pie', 'doughnut', 'radar'].includes(c.style)
      ? import('./echarts-radial.js')
      : ['treemap', 'sunburst'].includes(c.style)
        ? import('./echarts-hierarchy.js')
        : c.style === 'heatmap'
          ? import('./echarts-heatmap.js')
          : import('./echarts-sankey.js');
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function activateChart(
  node: HTMLElement,
  config: ChartConfig,
  modules?: ChartModules,
  attempt = 0,
) {
  const echarts = await import('./echarts-core.js');
  const key = cartesianChart(config)
    ? 'cartesian'
    : ['pie', 'doughnut', 'radar'].includes(config.style)
      ? 'radial'
      : ['treemap', 'sunburst'].includes(config.style)
        ? 'hierarchy'
        : config.style === 'heatmap'
          ? 'heatmap'
          : 'sankey';
  const renderer =
    attempt && modules?.[key]
      ? await import(/* @vite-ignore */ freshChartUrl(modules[key]!, attempt))
      : await family(config);
  renderer.register();
  const viewport = node.querySelector<HTMLElement>('.chart-viewport')!;
  const live = document.createElement('div');
  live.className = 'chart-live';
  live.style.height = '100%';
  const status = node.querySelector<HTMLElement>('.chart-status')!;
  const legends = [...node.querySelectorAll<HTMLButtonElement>('[data-series]')];
  const hidden = new Set<number>(),
    names = chartLegend(config);
  let chart: ECharts | undefined;
  let pinned = false,
    index = -1,
    series = 0,
    syncing = false;
  const fontScale = () =>
    Math.max(
      0.9,
      Math.min(
        1.5,
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--font-scale'),
        ) || 1,
      ),
    );
  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const create = () => {
    const c = echarts.init(live, null, { renderer: 'svg' });
    try {
      c.setOption(chartOptions(config, theme(), true, fontScale()));
    } catch (e) {
      c.dispose();
      throw e;
    }
    return c;
  };
  live.style.position = 'absolute';
  live.style.visibility = 'hidden';
  live.style.width = '100%';
  viewport.append(live);
  try {
    chart = create();
  } catch (e) {
    live.remove();
    throw e;
  }
  node.querySelector<HTMLElement>('.chart-static')?.setAttribute('hidden', '');
  viewport.querySelector(':scope > svg')?.setAttribute('hidden', '');
  live.style.position = '';
  live.style.visibility = '';
  live.style.width = '';
  const notify = (text: string) => {
    status.textContent = text;
  };
  const show = () => {
    if (!chart || index < 0) return;
    const dataIndex = ['treemap', 'sunburst'].includes(config.style) ? index + 1 : index;
    const seriesIndex =
      config.style === 'radar' ? 0 : Math.min(series, Math.max(0, config.series.length - 1));
    chart.dispatchAction({ type: 'downplay' });
    chart.dispatchAction({
      type: 'highlight',
      seriesIndex,
      dataIndex: config.style === 'radar' ? series : dataIndex,
      dataType: config.style === 'sankey' ? 'edge' : undefined,
    });
    chart.dispatchAction({
      type: 'showTip',
      seriesIndex,
      dataIndex: config.style === 'radar' ? series : dataIndex,
      dataType: config.style === 'sankey' ? 'edge' : undefined,
    });
    if (config.series.length) notify(chartPointLabel(config, series, index));
    else {
      const { headers, rows } = chartRows(config);
      notify(rows[index]?.map((v, i) => `${headers[i]}: ${v ?? '—'}`).join(' · ') || config.title);
    }
  };
  const selected = () => {
    if (!chart) return;
    chart.setOption({
      legend: { selected: Object.fromEntries(names.map((name, i) => [name, !hidden.has(i)])) },
    });
    legends.forEach((button, i) => button.setAttribute('aria-pressed', String(!hidden.has(i))));
    node.dataset.chartEmpty = String(hidden.size === names.length && names.length > 0);
    notify(
      hidden.size === names.length && names.length
        ? 'All series are hidden. Use Reset to restore them.'
        : `${names.length - hidden.size} of ${names.length} series shown.`,
    );
  };
  const reset = () => {
    hidden.clear();
    selected();
    pinned = false;
    index = -1;
    if (!chart) return;
    chart.dispatchAction({ type: 'dataZoom', start: 0, end: 100 });
    chart.dispatchAction({ type: 'hideTip' });
    chart.setOption(chartOptions(config, theme(), true, fontScale()), { notMerge: true });
    node.querySelectorAll<HTMLInputElement>('[data-chart-pan]').forEach((input) => {
      input.checked = false;
    });
    notify('Chart reset.');
  };
  const onSync = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (
      !config.syncGroup ||
      detail.group !== config.syncGroup ||
      detail.source === node ||
      !cartesianChart(config)
    )
      return;
    const i = config.labels.length
      ? config.labels.indexOf(String(detail.value))
      : (config.series[0]?.points?.findIndex((p) => p.x === detail.value) ?? -1);
    if (i < 0) return;
    syncing = true;
    index = i;
    series = 0;
    show();
    syncing = false;
  };
  chart.on('updateAxisPointer', (event: any) => {
    if (syncing || !config.syncGroup || !cartesianChart(config)) return;
    const axis = event.axesInfo?.find((a: any) => a.axisDim === (config.horizontal ? 'y' : 'x'));
    if (!axis) return;
    const value = config.labels.length ? (config.labels[axis.value] ?? axis.value) : axis.value;
    document.dispatchEvent(
      new CustomEvent('fieldnotes-chart-cursor', {
        detail: { group: config.syncGroup, value, source: node },
      }),
    );
  });
  document.addEventListener('fieldnotes-chart-cursor', onSync);
  const resize = new ResizeObserver(() => {
    if (!chart || !node.isConnected) return;
    live.style.height = '100%';
    chart.resize();
  });
  resize.observe(viewport);
  const appearance = new MutationObserver(() => {
    if (!chart) return;
    chart.setOption(chartOptions(config, theme(), true, fontScale()));
    selected();
  });
  appearance.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'data-reduce-motion'],
  });
  const onPointerLeave = () => {
    if (!pinned) chart?.dispatchAction({ type: 'hideTip' });
  };
  viewport.addEventListener('pointerleave', onPointerLeave);
  const dispose = () => {
    chart?.dispose();
    chart = undefined;
    resize.disconnect();
    appearance.disconnect();
    document.removeEventListener('fieldnotes-chart-cursor', onSync);
    removal.disconnect();
    viewport.removeEventListener('pointerleave', onPointerLeave);
  };
  const removal = new MutationObserver(() => {
    if (!node.isConnected) dispose();
  });
  removal.observe(document.body, { childList: true, subtree: true });
  window.addEventListener(
    'pagehide',
    (event) => {
      if (!event.persisted) dispose();
    },
    { once: true },
  );
  async function action(kind: string) {
    if (!chart) return;
    if (kind === 'reset') {
      reset();
      return;
    }
    if (kind.startsWith('zoom-')) {
      const zoom = (chart.getOption().dataZoom as any[])?.[0];
      const start = zoom?.start ?? 0,
        end = zoom?.end ?? 100,
        mid = (start + end) / 2,
        width = Math.min(100, Math.max(1, (end - start) * (kind === 'zoom-in' ? 0.6 : 1.6)));
      chart.dispatchAction({
        type: 'dataZoom',
        start: Math.max(0, mid - width / 2),
        end: Math.min(100, mid + width / 2),
      });
      return;
    }
    const filename = config.title.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 70) || 'chart';
    if (kind === 'csv') {
      download(
        new Blob(['\uFEFF' + chartCsv(config)], { type: 'text/csv;charset=utf-8' }),
        filename + '.csv',
      );
      notify('Full source data downloaded.');
      return;
    }
    const svg = chart.renderToSVGString();
    if (kind === 'svg') {
      download(new Blob([svg], { type: 'image/svg+xml' }), filename + '.svg');
      notify('Chart SVG downloaded.');
      return;
    }
    if (kind === 'png') {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(t("Image export failed")));
          image.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(chart.getWidth() * 2);
        canvas.height = Math.ceil(chart.getHeight() * 2);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = theme() === 'dark' ? '#182638' : '#f4f7fc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error(t("PNG export failed")))),
            'image/png',
          ),
        );
        download(blob, filename + '.png');
        notify('Chart PNG downloaded.');
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
  return {
    pointer(point: { x: number; y: number }) {
      chart?.dispatchAction({ type: 'showTip', x: point.x, y: point.y });
    },
    async click(event: MouseEvent) {
      const target = event.target as Element;
      const legend = target.closest<HTMLButtonElement>('[data-series]');
      if (legend) {
        const i = Number(legend.dataset.series);
        if (event.shiftKey) {
          hidden.clear();
          names.forEach((_, j) => {
            if (j !== i) hidden.add(j);
          });
        } else if (hidden.has(i)) hidden.delete(i);
        else hidden.add(i);
        selected();
        return;
      }
      const pan = target.closest<HTMLInputElement>('[data-chart-pan]');
      if (pan) {
        chart?.setOption({
          dataZoom: [
            { type: 'inside', moveOnMouseMove: pan.checked, preventDefaultMouseMove: pan.checked },
          ],
        });
        notify(pan.checked ? 'Pan enabled. Drag to move the selected range.' : 'Pan disabled.');
        return;
      }
      const kind = target.closest<HTMLElement>('[data-chart-action]')?.dataset.chartAction;
      if (kind) {
        try {
          await action(kind);
        } catch {
          notify('The chart could not be exported. Try SVG or CSV.');
        }
        return;
      }
      if (target.closest('.chart-viewport')) {
        pinned = !pinned;
        chart?.setOption({
          tooltip: { alwaysShowContent: pinned, triggerOn: pinned ? 'click' : 'mousemove|click' },
        });
      }
    },
    key(event: KeyboardEvent) {
      const total =
        config.series[series]?.points?.length ||
        config.labels.length ||
        chartRows(config).rows.length;
      if (event.key === 'Escape') {
        pinned = false;
        chart?.setOption({ tooltip: { alwaysShowContent: false, triggerOn: 'mousemove|click' } });
        chart?.dispatchAction({ type: 'hideTip' });
        notify('Tooltip dismissed.');
        return;
      }
      if (event.key === 'Enter') {
        pinned = !pinned;
        chart?.setOption({ tooltip: { alwaysShowContent: pinned } });
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const count = Math.max(1, config.series.length);
        let next = series;
        for (let n = 0; n < count; n++) {
          next = (next + (event.key === 'ArrowUp' ? -1 : 1) + count) % count;
          if (!hidden.has(next)) break;
        }
        series = next;
      } else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = total - 1;
      else index = Math.max(0, Math.min(total - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
      if (index < 0) index = 0;
      index = Math.min(index, (config.series[series]?.points?.length || total) - 1);
      show();
    },
    dispose,
  };
}
