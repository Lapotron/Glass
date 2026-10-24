import { it, expect } from 'vitest';
import { analyticsTrendTooltip } from '../src/shared/analytics-presentation.js';
import type { AcaReport } from '../src/shared/aca.js';
it('uses the real previous-period date and seconds in aligned comparison tooltips', () => {
  const current = { series: [{ day: '2026-10-23', active: 90 }] } as AcaReport;
  const previous = { series: [{ day: '2026-09-25', active: 60 }] } as AcaReport;
  const tooltip = analyticsTrendTooltip(current, previous, 'active', 0);
  expect(tooltip).toContain('Oct 23, 2026');
  expect(tooltip).toContain('Sep 25, 2026');
  expect(tooltip).toContain('90 s');
  expect(tooltip).toContain('60 s');
  expect(tooltip).toContain('Previous period');
});
