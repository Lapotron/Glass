import { z } from 'zod';
export const segmentDimensions = [
  'country',
  'device',
  'browser',
  'os',
  'source',
  'campaign',
  'language',
] as const;
export type SegmentDimension = (typeof segmentDimensions)[number];
const values = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(150)
      .regex(/^[^\p{Cc}]+$/u),
  )
  .min(1)
  .max(10);
export const acaSegmentSchema = z
  .object({
    country: values.optional(),
    device: values.optional(),
    browser: values.optional(),
    os: values.optional(),
    source: values.optional(),
    campaign: values.optional(),
    language: values.optional(),
  })
  .strict();
export type AcaSegment = z.infer<typeof acaSegmentSchema>;
export type SegmentCoverage = {
  days: number;
  coveredDays: number;
  missingDays: string[];
  from: string | null;
  to: string | null;
};
export type SegmentOptions = {
  options: Partial<Record<SegmentDimension, string[]>>;
  coverage: SegmentCoverage;
};
export function parseSegment(raw?: string | null): AcaSegment {
  if (!raw) return {};
  if (raw.length > 6000) throw new Error('Segment filters are too large.');
  let parsed: AcaSegment;
  try {
    parsed = acaSegmentSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('Choose valid audience segment filters.');
  }
  return Object.fromEntries(
    segmentDimensions
      .filter((key) => parsed[key]?.length)
      .map((key) => [key, [...new Set(parsed[key])].sort()]),
  );
}
export const hasSegment = (value: AcaSegment) =>
  segmentDimensions.some((key) => value[key]?.length);
/** Only fixed JSON paths enter SQL. Every selected value is bound separately. */
export function segmentSql(value: AcaSegment, column = 'segment_key') {
  const params: string[] = [];
  const clauses = segmentDimensions.flatMap((key, index) => {
    if (!value[key]?.length) return [];
    params.push(...value[key]);
    return [`json_extract(${column},'$[${index}]') IN (${value[key].map(() => '?').join(',')})`];
  });
  return { clause: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}
export const savedSegmentsSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(64),
            siteId: z.string().max(64),
            filters: acaSegmentSchema,
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.segments.map((s) => s.id)).size !== value.segments.length)
      ctx.addIssue({ code: 'custom', message: 'Saved segment identifiers must be unique.' });
  });
export type SavedSegments = z.infer<typeof savedSegmentsSchema>;
