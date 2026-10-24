import type { resolveContrast } from './contrast.js';

/** Reporting copy loads with Settings; the prepaint resolver stays small. */
export function contrastProtectionSummary(result: ReturnType<typeof resolveContrast>) {
  return `Picture wash: ${Math.round(result.wash * 100)}%. Functional glass: ${Math.round(result.glassOpacity * 100)}%. Article tint: ${Math.round(result.readingOpacity * 100)}%. ${result.settings.automatic ? 'Text colors and functional glass adjust. Wash and article tint stay as chosen.' : 'Manual settings; check the effective contrast below.'}`;
}
