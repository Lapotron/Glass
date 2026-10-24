import { contrastFloorRange } from './appearance-ranges.js';
export const textRoles = [
  'heading',
  'body',
  'secondary',
  'metadata',
  'link',
  'placeholder',
] as const;
export type TextRole = (typeof textRoles)[number];
export type ColorMode = 'light' | 'dark';
export type WallpaperWash = 'auto' | ColorMode;
export type ContrastSettings = {
  preset: 'balanced' | 'high';
  readingTarget: 4.5 | 7;
  interfaceTarget: 4.5 | 7;
  automatic: boolean;
  glassFloor: number;
  /** Retained for legacy notebook/reader preference round trips; no longer overrides article tint. */
  readingFloor: number;
  colors: Record<ColorMode, Partial<Record<TextRole, string>>>;
};
export type ContrastOverrides = Partial<Omit<ContrastSettings, 'colors'>> & {
  colors?: Partial<Record<ColorMode, Partial<Record<TextRole, string | null>>>>;
};
export const roleLabels: Record<TextRole, string> = {
  heading: 'Headings',
  body: 'Body text',
  secondary: 'Secondary text',
  metadata: 'Metadata & captions',
  link: 'Links',
  placeholder: 'Placeholders',
};
export function contrastPreset(preset: ContrastSettings['preset'] = 'balanced'): ContrastSettings {
  return {
    preset,
    readingTarget: 7,
    interfaceTarget: preset === 'high' ? 7 : 4.5,
    automatic: true,
    glassFloor: 0.58,
    readingFloor: 0.68,
    colors: { light: {}, dark: {} },
  };
}
export function parseContrastOverrides(input: unknown): ContrastOverrides {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>,
    result: ContrastOverrides = {};
  if (value.preset === 'balanced' || value.preset === 'high') result.preset = value.preset;
  for (const key of ['readingTarget', 'interfaceTarget'] as const)
    if (value[key] === 4.5 || value[key] === 7) result[key] = value[key];
  if (typeof value.automatic === 'boolean') result.automatic = value.automatic;
  for (const key of ['glassFloor', 'readingFloor'] as const)
    if (
      typeof value[key] === 'number' &&
      Number.isFinite(value[key]) &&
      value[key] >= contrastFloorRange[0] &&
      value[key] <= contrastFloorRange[1]
    )
      result[key] = value[key];
  const colors = value.colors as Record<string, unknown> | undefined;
  for (const mode of ['light', 'dark'] as const) {
    const palette = colors?.[mode] as Record<string, unknown> | undefined;
    for (const role of textRoles)
      if (
        palette?.[role] === null ||
        (typeof palette?.[role] === 'string' && /^#[a-f\d]{6}$/i.test(palette[role]))
      ) {
        result.colors ||= {};
        result.colors[mode] ||= {};
        result.colors[mode][role] = palette[role] as string | null;
      }
  }
  return result;
}
export function mergeContrast(
  base: ContrastSettings | undefined,
  patch?: ContrastOverrides,
): ContrastSettings {
  const defaults = base || contrastPreset();
  const safe = parseContrastOverrides(patch);
  const colors = { light: { ...defaults.colors.light }, dark: { ...defaults.colors.dark } };
  for (const mode of ['light', 'dark'] as const)
    for (const role of textRoles) {
      const color = safe.colors?.[mode]?.[role];
      if (color === null) delete colors[mode][role];
      else if (color !== undefined) colors[mode][role] = color;
    }
  return {
    ...defaults,
    ...safe,
    colors,
  };
}
type RGB = [number, number, number];
const rgb = (hex: string): RGB =>
  hex
    .slice(1)
    .match(/../g)!
    .map((v) => parseInt(v, 16)) as RGB;
const hex = (value: RGB) =>
  '#' + value.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export function blendColor(foreground: string, background: string, alpha: number) {
  const f = rgb(foreground),
    b = rgb(background);
  return hex(f.map((v, i) => v * alpha + b[i] * (1 - alpha)) as RGB);
}
export function luminance(color: string) {
  const v = rgb(color).map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function contrastAgainstBounds(color: string, bounds: [string, string]) {
  const value = luminance(color),
    low = Math.min(...bounds.map(luminance)),
    high = Math.max(...bounds.map(luminance));
  // A matching intermediate image color is as important as its bright/dark endpoints.
  if (value >= low && value <= high) return 1;
  return Math.min(...bounds.map((background) => contrastRatio(color, background)));
}
export function readableColor(
  color: string,
  bounds: [string, string],
  target: number,
  mode: ColorMode,
) {
  const ink = mode === 'light' ? '#000000' : '#ffffff';
  if (contrastAgainstBounds(color, bounds) >= target) return color;
  for (let amount = 1; amount <= 100; amount++) {
    const result = blendColor(ink, color, amount / 100);
    if (contrastAgainstBounds(result, bounds) >= target) return result;
  }
  return ink;
}
export function baseTextColors(
  settings: ContrastSettings,
  mode: ColorMode,
  accent: string,
): Record<TextRole, string> {
  const colors =
    mode === 'light'
      ? {
          heading: '#101827',
          body: '#1b2433',
          secondary: '#3c4c63',
          metadata: '#495b74',
          link: accent,
          placeholder: '#495b74',
        }
      : {
          heading: '#f1f5f9',
          body: '#e8edf5',
          secondary: '#c4cedd',
          metadata: '#adbbcf',
          link: accent,
          placeholder: '#adbbcf',
        };
  if (settings.preset === 'high')
    for (const role of textRoles)
      colors[role] = blendColor(mode === 'light' ? '#000000' : '#ffffff', colors[role], 0.25);
  return { ...colors, ...settings.colors[mode] };
}
type Theme = {
  contrast?: ContrastSettings;
  accent: string;
  background: 'sky' | 'sand' | 'mist';
  backgroundImage: string;
  glassOpacity: number;
  readingOpacity: number;
  wallpaperDim: number;
  wallpaperWash?: WallpaperWash;
};
export function resolveContrast(theme: Theme, mode: ColorMode) {
  const settings = mergeContrast(theme.contrast),
    photo = Boolean(theme.backgroundImage);
  const light = { sky: '#eef3fa', sand: '#f5efe5', mist: '#eaf2ef' };
  const base = mode === 'light' ? light[theme.background] : '#10141e';
  const washMode =
    !theme.wallpaperWash || theme.wallpaperWash === 'auto' ? mode : theme.wallpaperWash;
  const washColor =
    washMode === 'light'
      ? { sky: '#e6effa', sand: '#f7eddd', mist: '#e5f1eb' }[theme.background]
      : '#10141e';
  const tint =
    mode === 'light'
      ? { sky: '#d0e1f7', sand: '#ebdac3', mist: '#cce4db' }[theme.background]
      : { sky: '#1f2c41', sand: '#302922', mist: '#1d2f2d' }[theme.background];
  const requested = baseTextColors(settings, mode, theme.accent);
  const target = (role: TextRole) =>
    role === 'body' || role === 'heading' ? settings.readingTarget : settings.interfaceTarget;
  const glassOpacity = photo
    ? Math.max(theme.glassOpacity, settings.glassFloor)
    : theme.glassOpacity;
  const readingOpacity = Math.min(
    1,
    (theme.glassOpacity + (mode === 'dark' ? 0.2 : 0)) * theme.readingOpacity,
  );
  let protection = glassOpacity;
  const boundsAt = (amount: number): [string, string] => {
    const wash = theme.wallpaperDim;
    const candidates = photo
      ? [blendColor(washColor, '#000000', wash), blendColor(washColor, '#ffffff', wash), tint].map(
          (color) => blendColor(tint, color, amount),
        )
      : [base, tint];
    candidates.sort((a, b) => luminance(a) - luminance(b));
    return [candidates[0], candidates[candidates.length - 1]];
  };
  if (photo && settings.automatic) {
    const ink = mode === 'light' ? '#000000' : '#ffffff';
    // Protect functional glass only. Picture wash and article tint remain author/reader choices.
    while (
      protection < 1 &&
      contrastAgainstBounds(ink, boundsAt(protection)) <
        Math.max(settings.readingTarget, settings.interfaceTarget)
    )
      protection = Math.min(1, protection + 0.01);
    protection = Math.min(1, protection + 0.04);
  }
  const candidates = [...boundsAt(protection), ...boundsAt(readingOpacity)].sort(
    (a, b) => luminance(a) - luminance(b),
  );
  const bounds: [string, string] = [candidates[0], candidates[candidates.length - 1]];
  const colors = { ...requested };
  for (const role of textRoles)
    if (settings.automatic)
      colors[role] = readableColor(requested[role], bounds, target(role), mode);
  return {
    colors,
    materialTint: tint,
    canvas: base,
    requested,
    bounds,
    wash: theme.wallpaperDim,
    washTint: rgb(washColor).join(' '),
    settings,
    glassOpacity: photo ? Math.max(glassOpacity, protection) : glassOpacity,
    readingOpacity,
    ratios: Object.fromEntries(
      textRoles.map((role) => [role, contrastAgainstBounds(colors[role], bounds)]),
    ) as Record<TextRole, number>,
  };
}
