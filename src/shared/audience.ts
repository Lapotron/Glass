import { z } from 'zod';

/** Deliberately coarse capabilities, not a browser fingerprint. */
export const audienceClientSchema = z
  .object({
    viewport: z.enum(['small', 'medium', 'large', 'wide']).optional(),
    screen: z.enum(['small', 'medium', 'large', 'wide']).optional(),
    density: z.enum(['1', '2', '3+']).optional(),
    orientation: z.enum(['portrait', 'landscape']).optional(),
    theme: z.enum(['light', 'dark']).optional(),
    motion: z.enum(['reduce', 'normal']).optional(),
    cores: z.enum(['1–2', '3–4', '5–8', '9+']).optional(),
    memory: z.enum(['≤2', '4', '8+']).optional(),
  })
  .strict();
export type AudienceClient = z.infer<typeof audienceClientSchema>;
export type AudienceMetadata = {
  country: string;
  continent: string;
  region: string;
  city: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  asn: string;
  network: string;
  edge: string;
  protocol: string;
  tls: string;
  browser: string;
  os: string;
  engine: string;
  device: string;
} & AudienceClient;
export type GeographyPoint = {
  country: string;
  continent: string;
  region: string;
  city: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  views: number;
  qualified: number;
  active: number;
};
export const audienceDimensions = [
  'browser',
  'os',
  'engine',
  'device',
  'asn',
  'network',
  'edge',
  'protocol',
  'tls',
  'timezone',
  'viewport',
  'screen',
  'density',
  'orientation',
  'theme',
  'motion',
  'cores',
  'memory',
] as const;
export type AudienceTotals = Record<string, { views: number; qualified: number; active: number }>;
export function audienceEntries(audience: Partial<AudienceMetadata>): [string, string][] {
  return [
    [
      'geo',
      JSON.stringify({
        country: audience.country || 'Unknown',
        continent: audience.continent || '',
        region: audience.region || '',
        city: audience.city || '',
        timezone: audience.timezone || '',
        latitude: audience.latitude ?? null,
        longitude: audience.longitude ?? null,
      }),
    ],
    ...audienceDimensions.map((key): [string, string] => [key, String(audience[key] || 'Unknown')]),
  ];
}
export function accumulateAudience(
  totals: AudienceTotals,
  audience: string | undefined,
  active: number,
) {
  let metadata: Partial<AudienceMetadata> = {};
  try {
    metadata = JSON.parse(audience || '{}');
  } catch {
    /* Old observations remain unknown. */
  }
  for (const [dimension, value] of audienceEntries(metadata)) {
    const key = JSON.stringify([dimension, value]);
    const bounded =
      key in totals || Object.keys(totals).length < 1024
        ? key
        : JSON.stringify([dimension, dimension === 'geo' ? audienceEntries({})[0][1] : 'Unknown']);
    const row = (totals[bounded] ||= { views: 0, qualified: 0, active: 0 });
    row.views++;
    row.qualified += Number(active >= 10000);
    row.active += active;
  }
}
/** Fixed logarithmic bins: bounded, mergeable, with explicitly approximate quantiles. */
export function vitalBucket(value: number) {
  return Math.min(63, Math.max(0, Math.ceil(Math.log1p(value) / Math.log(1.3))));
}
export function vitalQuantile(
  rows: { bucket: number; count: number }[],
  percentile: number,
): number | null {
  const count = rows.reduce((n, row) => n + row.count, 0);
  if (!count) return null;
  let cumulative = 0;
  for (const row of [...rows].sort((a, b) => a.bucket - b.bucket)) {
    cumulative += row.count;
    if (cumulative >= Math.ceil(count * percentile))
      return Math.max(0, Math.pow(1.3, row.bucket) - 1);
  }
  return null;
}
