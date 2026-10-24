import type { SiteConfig } from './contracts.js';
import { themeVariables } from './theme.js';

export type DiagramPalette = { text: string; secondary: string; surface: string };
export type DiagramPresentation = {
  fontFamily: string;
  fontSize: number;
  light: DiagramPalette;
  dark: DiagramPalette;
};
export const defaultDiagramPresentation: DiagramPresentation = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: 16,
  light: { text: '#1b2433', secondary: '#3c4c63', surface: '#e7edf5' },
  dark: { text: '#e3eaf6', secondary: '#bcc9dc', surface: '#243044' },
};
/** Same resolved reading family and semantic ink as the surrounding article, not a second theme. */
export function diagramPresentation(theme: SiteConfig['theme']): DiagramPresentation {
  const values = themeVariables(theme);
  return {
    ...defaultDiagramPresentation,
    fontFamily: String(values['--reading-font']),
    fontSize: Math.round(16 * theme.fontScale * (theme.textScale ?? 1) * 100) / 100,
    ...Object.fromEntries(
      (['light', 'dark'] as const).map((mode) => [
        mode,
        {
          ...defaultDiagramPresentation[mode],
          text: String(values[`--foreground-body-${mode}`]),
          secondary: String(values[`--foreground-secondary-${mode}`]),
        },
      ]),
    ),
  };
}
