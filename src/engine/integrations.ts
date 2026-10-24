import type { SiteConfig } from '../shared/contracts.js';
import { themeVariables } from '../shared/theme.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blendColor, resolveContrast } from '../shared/contrast.js';

const discussionStyles = readFileSync(new URL('../site/giscus-theme.css', import.meta.url), 'utf8');

/** Fingerprinted per notebook theme; Giscus loads this CSS in its own origin. */
export function discussionThemePrefix(site: SiteConfig) {
  return `/assets/themes/${createHash('sha256')
    .update(discussionThemeCss(site, 'light') + discussionThemeCss(site, 'dark'))
    .digest('hex')
    .slice(0, 20)}/discussion-`;
}
export function discussionThemeCss(site: SiteConfig, mode: 'light' | 'dark') {
  const dark = mode === 'dark',
    vars = themeVariables(site.theme),
    material = resolveContrast(site.theme, mode);
  const fg = vars[`--foreground-body-${mode}`],
    muted = vars[`--foreground-secondary-${mode}`],
    subtle = vars[`--foreground-metadata-${mode}`];
  const accent = vars[`--accent-text-${mode}`],
    fill = material.materialTint
      .match(/[a-f0-9]{2}/gi)!
      .map((part) => parseInt(part, 16))
      .join(' '),
    overlay = blendColor(material.materialTint, material.canvas, 0.7);
  // Giscus/Primer variables are resolved here: iframe documents cannot inherit parent CSS variables.
  const colors: Record<string, string | number> = {
    'fg-default': fg,
    'fg-muted': muted,
    'fg-subtle': subtle,
    'fg-on-emphasis': '#fff',
    'canvas-default': 'transparent',
    'canvas-overlay': overlay,
    'canvas-inset': 'var(--gsc-inset)',
    'canvas-subtle': 'var(--gsc-control)',
    'border-default': dark ? '#c6d8ff29' : '#6882ab35',
    'border-muted': dark ? '#c6d8ff17' : '#6882ab22',
    'neutral-muted': 'var(--gsc-inset)',
    'neutral-emphasis-plus': fg,
    'accent-fg': accent,
    'accent-emphasis': site.theme.accent,
    'accent-muted': `${site.theme.accent}44`,
    'accent-subtle': `${site.theme.accent}16`,
    'btn-text': fg,
    'btn-bg': 'var(--gsc-control)',
    'btn-border': dark ? '#b0c8ff35' : '#6b8cbb36',
    'btn-shadow': '0 2px 8px #152a4810',
    'btn-inset-shadow': dark ? 'inset 0 1px #ffffff0c' : 'inset 0 1px #ffffffa0',
    'btn-hover-bg': 'var(--gsc-control-hover)',
    'btn-hover-border': `${site.theme.accent}70`,
    'btn-active-bg': `${site.theme.accent}22`,
    'btn-primary-bg': site.theme.accent,
    'btn-primary-text': vars['--accent-ink'],
    'btn-primary-border': 'transparent',
    'btn-primary-hover-bg': site.theme.accent,
    'btn-primary-hover-border': 'transparent',
    'btn-primary-selected-bg': site.theme.accent,
    'btn-primary-disabled-bg': `${site.theme.accent}70`,
    'btn-primary-disabled-text': vars['--accent-ink'],
    'btn-primary-disabled-border': 'transparent',
    'success-fg': dark ? '#77d8b9' : '#196d53',
    'success-emphasis': '#23856c',
    'success-subtle': '#23856c16',
    'danger-fg': dark ? '#ff9fa8' : '#aa3046',
    'danger-emphasis': '#ba4055',
    'danger-subtle': '#ba405516',
    'attention-fg': dark ? '#efce82' : '#795616',
    'attention-subtle': '#ae85321a',
    'social-reaction-bg-hover': `${site.theme.accent}20`,
    'social-reaction-bg-reacted-hover': `${site.theme.accent}30`,
    'scale-gray-7': dark ? '#25344c' : '#e4ecf7',
    'scale-gray-1': dark ? '#17243a' : '#edf2f9',
    'scale-blue-1': dark ? '#213a5a' : '#dceaff',
    'scale-blue-8': site.theme.accent,
    'prettylights-syntax-comment': subtle,
    'prettylights-syntax-constant': dark ? '#a4c9ff' : '#0755aa',
    'prettylights-syntax-entity': dark ? '#d6b9ff' : '#6740a1',
    'prettylights-syntax-storage-modifier-import': fg,
    'prettylights-syntax-entity-tag': dark ? '#99d9a3' : '#236333',
    'prettylights-syntax-keyword': dark ? '#ff9da9' : '#ad2940',
    'prettylights-syntax-string': dark ? '#b4d4ff' : '#184b7d',
    'prettylights-syntax-variable': dark ? '#ffc790' : '#89440b',
    'prettylights-syntax-brackethighlighter-unmatched': '#b43d50',
    'prettylights-syntax-invalid-illegal-bg': '#9c263c',
  };
  Object.assign(colors, {
    'btn-active-border': 'var(--color-btn-hover-border)',
    'btn-selected-bg': 'var(--color-btn-active-bg)',
    'btn-primary-shadow': '0 2px 7px #16305018',
    'btn-primary-inset-shadow': 'inset 0 1px #ffffff20',
    'btn-primary-selected-shadow': 'inset 0 1px 3px #10203028',
    'action-list-item-default-hover-bg': 'var(--color-btn-hover-bg)',
    'segmented-control-bg': 'var(--color-canvas-inset)',
    'segmented-control-button-bg': 'var(--color-canvas-subtle)',
    'segmented-control-button-selected-border': 'var(--color-accent-muted)',
    'attention-muted': '#ae853244',
    'danger-muted': '#ba405540',
    'primer-shadow-inset': 'inset 0 1px 2px #1020300a',
    'prettylights-syntax-invalid-illegal-text': '#ffffff',
    'prettylights-syntax-carriage-return-text': '#ffffff',
    'prettylights-syntax-carriage-return-bg': '#9c263c',
    'prettylights-syntax-string-regexp': dark ? '#a5e5c5' : '#176445',
    'prettylights-syntax-markup-list': dark ? '#f2ce94' : '#79580e',
    'prettylights-syntax-markup-heading': accent,
    'prettylights-syntax-markup-italic': fg,
    'prettylights-syntax-markup-bold': fg,
    'prettylights-syntax-markup-deleted-text': dark ? '#ffb2bc' : '#8e2636',
    'prettylights-syntax-markup-deleted-bg': dark ? '#60263566' : '#a82d4220',
    'prettylights-syntax-markup-inserted-text': dark ? '#a8e5c6' : '#1b5e37',
    'prettylights-syntax-markup-inserted-bg': dark ? '#245a3c66' : '#27845120',
    'prettylights-syntax-markup-changed-text': dark ? '#f7cf9b' : '#764b13',
    'prettylights-syntax-markup-changed-bg': '#ae853222',
    'prettylights-syntax-markup-ignored-text': muted,
    'prettylights-syntax-markup-ignored-bg': 'var(--color-canvas-subtle)',
    'prettylights-syntax-meta-diff-range': dark ? '#ccb9ff' : '#5d3aa4',
    'prettylights-syntax-brackethighlighter-angle': subtle,
    'prettylights-syntax-sublimelinter-gutter-mark': subtle,
    'prettylights-syntax-constant-other-reference-link': accent,
  });
  const surface = (opacity: number) =>
    site.theme.reduceTransparency ? overlay : `rgb(${fill} / ${opacity})`;
  // The parent discussion panel owns the glass. Iframe insets must not stack
  // another dense panel over it, especially when the parent is in light mode.
  const opacity = Math.min(1, Math.max(0, site.theme.glassOpacity));
  const materials = {
    '--gsc-font':
      '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    '--gsc-mono': '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
    '--gsc-font-scale': site.theme.fontScale,
    '--gsc-radius': `${Math.min(22, Math.max(0, site.theme.cornerRadius * 0.75))}px`,
    '--gsc-padding': '16px',
    '--gsc-panel': surface(opacity * (dark ? 0.12 : 0.08)),
    '--gsc-inset': surface(opacity * (dark ? 0.06 : 0.04)),
    '--gsc-control': surface(opacity * (dark ? 0.24 : 0.2)),
    '--gsc-control-hover': surface(opacity * 0.32),
    '--gsc-code': surface(opacity * (dark ? 0.5 : 0.45)),
    '--gsc-highlight': dark ? '#d4e4ff0d' : '#f3f8ff99',
    '--gsc-sheen': dark
      ? `rgb(182 211 255 / ${opacity * 0.025})`
      : `rgb(239 247 255 / ${opacity * 0.04})`,
    '--gsc-shadow': dark ? '0 8px 24px #00000014' : '0 8px 24px #2d467008',
    '--gsc-menu-shadow': dark ? '0 16px 42px #00000045' : '0 16px 42px #16304c24',
    '--gsc-preview-canvas': material.canvas,
  };
  return `/* Glass · Giscus custom theme v4. Public, token-derived, no tracking. */\n:root,main{color-scheme:${mode};${Object.entries(
    colors,
  )
    .map(([key, value]) => `--color-${key}:${value};`)
    .join('')}${Object.entries(materials)
    .map(([key, value]) => `${key}:${value};`)
    .join('')}}\n${discussionStyles}`;
}
