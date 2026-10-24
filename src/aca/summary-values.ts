import type { ViewRow } from './aggregate.js';
import { addCardinality, cardinalitySize } from './cardinality.js';
import { accumulateAudience, type AudienceTotals } from '../shared/audience.js';
export type Accumulator = {
  audience: AudienceTotals;
  views: number;
  active: number;
  qualified: number;
  completed: number;
  optin: number;
  hll: number[];
  visitors: string[];
  retention: { reached: number; activeMs: number; dropoffs: number }[];
  sources: Record<string, number>;
  sections: Record<string, { active: number; views: number }>;
};
export const empty = (): Accumulator => ({
  audience: {},
  views: 0,
  active: 0,
  qualified: 0,
  completed: 0,
  optin: 0,
  hll: Array(cardinalitySize).fill(0),
  visitors: [],
  retention: Array.from({ length: 20 }, () => ({ reached: 0, activeMs: 0, dropoffs: 0 })),
  sources: {},
  sections: {},
});
export function accumulate(state: Accumulator, rows: ViewRow[]) {
  const visitors = new Set(state.visitors);
  state.audience ||= {};
  for (const row of rows) {
    accumulateAudience(state.audience, row.audience, row.active);
    state.views++;
    state.active += row.active;
    state.qualified += Number(row.active >= 10000);
    const buckets = JSON.parse(row.buckets) as number[];
    let reached = 0,
      last = 0;
    buckets.forEach((ms, i) => {
      state.retention[i].activeMs += ms;
      if (ms >= 1000) {
        state.retention[i].reached++;
        reached++;
        last = i;
      }
    });
    state.completed += Number(Boolean(row.end_seen) && reached >= 16);
    if (row.active >= 10000 && reached > 0 && !(row.end_seen && reached >= 16))
      state.retention[last].dropoffs++;
    if (row.visitor) {
      state.optin++;
      visitors.add(row.visitor);
      addCardinality(state.hll, row.visitor);
    }
    for (const key of [
      'source:' + (row.source || 'direct'),
      'device:' + row.device,
      'campaign:' + (row.campaign || '(none)'),
      'language:' + row.language,
    ]) {
      const bounded =
        key in state.sources || Object.keys(state.sources).length < 512
          ? key
          : key.split(':')[0] + ':(other)';
      state.sources[bounded] = (state.sources[bounded] || 0) + 1;
    }
    for (const [key, active] of Object.entries(
      JSON.parse(row.sections) as Record<string, number>,
    )) {
      if (!(key in state.sections) && Object.keys(state.sections).length >= 256) continue;
      const section = (state.sections[key] ||= { active: 0, views: 0 });
      section.active += active;
      section.views++;
    }
  }
  // Legacy opted-in datasets remain bounded too; current readers never create identities.
  if (visitors.size > 2000)
    throw new Error('Legacy audience group exceeds the free-tier summary bound.');
  state.visitors = [...visitors];
}
