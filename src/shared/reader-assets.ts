export type ReaderAssets = {
  version: 1;
  basePath?: string;
  script: string;
  style: string;
  appearance: string;
  codeStyle?: string;
  discoveryStyle?: string;
  contentStyle?: string;
  settingsStyle?: string;
  toolsScript?: string;
  toolsStyle?: string;
  search?: string;
  archiveWorker?: string;
  chartModules?: import('./chart-modules.js').ChartModules;
};
/** Allows local previews to open an artifact produced before asset fingerprinting. */
export const legacyReaderAssets: ReaderAssets = {
  version: 1,
  script: '/assets/site.js',
  style: '/assets/site.css',
  appearance: '/assets/appearance.js',
};
