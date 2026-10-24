import { t } from './i18n.js';
import type { SiteConfig } from './contracts.js';
import { baseTextColors, mergeContrast, resolveContrast, textRoles } from './contrast.js';
import { contrastProtectionSummary } from './contrast-report.js';
import { updateRange } from './forms.js';
export function syncContrastControls(form: HTMLElement, theme: SiteConfig['theme']) {
  const value = mergeContrast(theme.contrast);
  form
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-contrast-control]')
    .forEach((control) => {
      const current =
        value[control.dataset.contrastControl as Exclude<keyof typeof value, 'colors'>];
      if (control instanceof HTMLInputElement && control.type === 'checkbox')
        control.checked = Boolean(current);
      else control.value = String(current);
      if (control instanceof HTMLInputElement && control.type === 'range') updateRange(control);
    });
  for (const key of ['glassFloor'] as const) {
    const output = form.querySelector<HTMLOutputElement>(`[data-contrast-output="${key}"]`);
    if (output) output.value = Math.round(value[key] * 100) + '%';
  }
  for (const mode of ['light', 'dark'] as const) {
    const selected = baseTextColors(value, mode, theme.accent),
      result = resolveContrast(theme, mode);
    for (const role of textRoles) {
      const input = form.querySelector<HTMLInputElement>(
        `[data-contrast-mode="${mode}"][data-contrast-role="${role}"]`,
      );
      if (input) input.value = selected[role];
      const color = form.querySelector(`[data-contrast-hex="${mode}.${role}"]`);
      if (color) color.textContent = selected[role];
      const report = form.querySelector(`[data-contrast-result="${mode}.${role}"]`);
      if (report)
        report.textContent = t("{value0} → {value1} · {value2}:1{value3}", {value0: result.requested[role], value1: result.colors[role], value2: result.ratios[role].toFixed(2), value3: result.ratios[role] < (role === 'body' || role === 'heading' ? value.readingTarget : value.interfaceTarget) ? ' · Needs attention' : ''});
    }
    const protection = form.querySelector(`[data-contrast-protection="${mode}"]`);
    if (protection) protection.textContent = contrastProtectionSummary(result);
  }
}
