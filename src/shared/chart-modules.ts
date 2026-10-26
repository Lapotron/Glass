import { publicAsset, readerBasePath } from './public-path.js';
export const chartModuleKeys = [
  'runtime',
  'cartesian',
  'radial',
  'hierarchy',
  'heatmap',
  'sankey',
] as const;
export type ChartModules = Partial<Record<(typeof chartModuleKeys)[number], string>>;
export function validChartModules(value: unknown, basePath = readerBasePath()): value is ChartModules {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, url]) =>
        chartModuleKeys.includes(key as any) &&
        typeof url === 'string' &&
        publicAsset(url, /^\/assets\/bundles\/[a-f0-9]{20}\/chunks\/echarts-(?:runtime|cartesian|radial|hierarchy|heatmap|sankey)-[\w-]+\.js$/, basePath),
    )
  );
}
export function freshChartUrl(url: string, attempt: number) {
  if (!validChartModules({ runtime: url })) throw new Error('The chart module URL is invalid.');
  return url + '?retry=' + Math.max(1, Math.floor(attempt));
}
