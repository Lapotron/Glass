import type { SiteConfig } from './contracts.js';
import { contrastRatio as contrast, resolveContrast } from './contrast.js';
function textAccent(accent: string, background: string, toward: number) {
  const rgb = accent.match(/[a-f0-9]{2}/gi)!.map((v) => parseInt(v, 16));
  let result = accent;
  for (let i = 0; i <= 100 && contrast(result, background) < 4.8; i++)
    result =
      '#' +
      rgb
        .map((v) =>
          Math.round(v + ((toward - v) * i) / 100)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
  return result;
}
export function themeVariables(theme: SiteConfig['theme']): Record<string, string | number> {
  const readingFonts = {
    system:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    serif: 'Charter, "Iowan Old Style", "Palatino Linotype", "Songti SC", Georgia, serif',
    humanist: 'Optima, Candara, "Trebuchet MS", "PingFang SC", sans-serif',
  };
  const variables: Record<string, string | number> = {
    '--accent': theme.accent,
    '--accent-ink':
      contrast(theme.accent, '#ffffff') >= contrast(theme.accent, '#10141e')
        ? '#ffffff'
        : '#10141e',
    '--accent-text-light': textAccent(theme.accent, '#e8edf5', 0),
    '--accent-text-dark': textAccent(theme.accent, '#263044', 255),
    '--font-scale': theme.fontScale,
    '--reader-text-scale': theme.textScale ?? 1,
    '--content-width': `${theme.contentWidth}px`,
    '--page-background-image': theme.backgroundImage ? `url("${theme.backgroundImage}")` : 'none',
    '--glass-strength': theme.glass,
    '--glass-blur': `${theme.glassBlur}px`,
    '--glass-opacity': theme.glassOpacity,
    '--glass-saturation': `${theme.glassSaturation}%`,
    '--reading-opacity': theme.readingOpacity,
    '--reading-font': readingFonts[theme.fontFamily],
    '--article-width': `${theme.articleWidth}px`,
    '--reading-leading': theme.lineHeight,
    '--paragraph-space': `${theme.paragraphSpace}em`,
    '--radius': `${theme.cornerRadius}px`,
    '--wallpaper-blur': `${theme.wallpaperBlur}px`,
    '--wallpaper-dim': theme.wallpaperDim,
    '--wallpaper-position': theme.wallpaperPosition,
    '--ambient-intensity': theme.ambientIntensity,
  };
  for (const mode of ['light', 'dark'] as const) {
    const resolved = resolveContrast(theme, mode);
    for (const [role, color] of Object.entries(resolved.colors))
      variables[`--foreground-${role}-${mode}`] = color;
    variables[`--wallpaper-wash-tint-${mode}`] = resolved.washTint;
    variables[`--protected-glass-${mode}`] = resolved.glassOpacity;
    // Accent UI must be readable independently of a custom prose-link override.
    variables[`--accent-text-${mode}`] = textAccent(
      theme.accent,
      resolved.bounds[mode === 'light' ? 0 : 1],
      mode === 'light' ? 0 : 255,
    );
  }
  return variables;
}
