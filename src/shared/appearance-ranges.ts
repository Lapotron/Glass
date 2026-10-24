/** Shared presentation bounds. Keep this module free of schema, DOM and renderer imports. */
export const appearanceRanges = {
  fontScale: [0.8, 1.5, 0.05],
  contentWidth: [720, 1600, 16],
  articleWidth: [480, 1200, 16],
  lineHeight: [1.3, 2.6, 0.05],
  paragraphSpace: [0, 3, 0.05],
  glass: [0, 2, 0.05],
  glassBlur: [0, 64, 1],
  glassOpacity: [0, 1, 0.01],
  glassSaturation: [0, 300, 5],
  readingOpacity: [0, 1, 0.01],
  cornerRadius: [0, 64, 1],
  ambientIntensity: [0, 2, 0.05],
  wallpaperBlur: [0, 64, 1],
  wallpaperDim: [0, 1, 0.01],
} as const;
export const textScaleRange = [0.8, 2, 0.05] as const;
export const contrastFloorRange = [0, 1, 0.01] as const;

/** Separate labels so the preference parser and prepaint bundle carry numeric bounds only. */
export const appearanceLabels = {
  fontScale: ['Interface scale', ''],
  contentWidth: ['Page width', 'px'],
  articleWidth: ['Reading width', 'px'],
  lineHeight: ['Line height', ''],
  paragraphSpace: ['Paragraph spacing', 'em'],
  glass: ['Glass strength', ''],
  glassBlur: ['Glass blur', 'px'],
  glassOpacity: ['Glass tint', ''],
  glassSaturation: ['Glass saturation', '%'],
  readingOpacity: ['Article background tint', ''],
  cornerRadius: ['Panel corners', 'px'],
  ambientIntensity: ['Ambient light', ''],
  wallpaperBlur: ['Picture blur', 'px'],
  wallpaperDim: ['Picture wash', ''],
  textScale: ['Reading text size', ''],
} as const satisfies Record<keyof typeof appearanceRanges | 'textScale', readonly [string, string]>;
