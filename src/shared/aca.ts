import { z } from 'zod';
import { audienceClientSchema } from './audience.js';
import type { AcaSegment, SegmentCoverage } from './aca-segments.js';
export const acaSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z
      .string()
      .max(500)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, 'Use the HTTPS Worker origin, without a path or credentials.')
      .default(''),
    siteId: z
      .string()
      .regex(/^$|^[a-zA-Z0-9_-]{1,64}$/)
      .default(''),
    collectInteractions: z.boolean().default(true),
    collectVitals: z.boolean().default(true),
    dailyNetworkEstimates: z.boolean().default(false),
    collectAudience: z.boolean().default(true),
    optionalHistory: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && (!value.endpoint || !value.siteId))
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the ACA endpoint and site ID before enabling analytics.',
      });
  });
export type AcaSettings = z.infer<typeof acaSettingsSchema>;
export const acaActions = [
  'impression',
  'click',
  'outbound',
  'download',
  'share',
  'copy',
  'media',
  'widget',
  'search',
  'vital',
  'error',
] as const;
const identity = z.string().regex(/^[\w-]{16,100}$/);
const safeKey = z
  .string()
  .max(240)
  .regex(/^[\p{L}\p{N}_./:#%+ -]*$/u);
export const acaEventSchema = z
  .object({
    id: identity,
    action: z.enum(acaActions),
    target: safeKey.default(''),
    surface: z
      .string()
      .regex(/^[a-z-]{0,40}$/)
      .default(''),
    rank: z.number().int().min(0).max(10000).default(0),
    value: z.number().min(0).max(3600000).default(0),
  })
  .strict();
export const acaBatchSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    audience: audienceClientSchema.optional(),
    site: z.string().regex(/^[\w-]{1,64}$/),
    view: identity,
    content: safeKey,
    revision: z.string().regex(/^[a-f0-9]{0,64}$/),
    route: z
      .string()
      .max(500)
      .regex(/^\/(?!\/)[^?#\s]*$/),
    sequence: z.number().int().min(0).max(5000),
    active: z.number().int().min(0).max(86400000),
    depth: z.number().min(0).max(100),
    buckets: z.array(z.number().int().min(0).max(86400000)).length(20),
    sections: z
      .record(z.string().regex(/^[\p{L}\p{N}_-]{1,100}$/u), z.number().int().min(0).max(86400000))
      .refine((v) => Object.keys(v).length <= 100),
    end: z.boolean(),
    ended: z.boolean(),
    consent: z.enum(['anonymous', 'opt-in']),
    visitor: z.string().uuid().optional(),
    networkEstimate: z.boolean().optional(),
    source: z
      .string()
      .max(150)
      .regex(/^[a-zA-Z0-9._:-]*$/),
    campaign: z
      .string()
      .max(100)
      .regex(/^[\w .-]*$/),
    device: z.enum(['phone', 'tablet', 'desktop']),
    language: z.string().regex(/^[a-z]{2,3}$/),
    events: z.array(acaEventSchema).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.consent === 'opt-in') !== Boolean(value.visitor))
      ctx.addIssue({ code: 'custom', message: 'Visitor identity requires explicit opt-in.' });
    if (value.buckets.reduce((a, b) => a + b, 0) > value.active + 10000)
      ctx.addIssue({ code: 'custom', message: 'Dwell time exceeds active time.' });
  });
export type AcaBatch = z.infer<typeof acaBatchSchema>;
export type AcaEvent = z.infer<typeof acaEventSchema>;
export const acaReports = [
  'overview',
  'reach',
  'engagement',
  'audience',
  'content',
  'quality',
  'geography',
  'technology',
  'visits',
] as const;
export type AcaReportName = (typeof acaReports)[number];
export type AcaReport = {
  segment?: AcaSegment;
  coverage?: SegmentCoverage;
  name: AcaReportName;
  from: string;
  to: string;
  generatedAt: string;
  timezone: 'UTC';
  metrics: { label: string; value: number | null; unit?: string; note?: string }[];
  series: {
    day: string;
    views: number;
    active: number;
    qualified: number;
    impressions: number;
    clicks: number;
    visitors?: number;
    networks?: number | null;
  }[];
  rows: Record<string, string | number | null>[];
  retention: { progress: number; reached: number; activeMs: number; dropoffs: number }[];
  cohorts: {
    cohort: string;
    browsers: number;
    day1: number;
    day7: number;
    day30: number;
    day90: number;
    day180: number;
  }[];
  breakdowns?: { name: string; rows: Record<string, string | number | null>[] }[];
  freshness: string | null;
  notes: string[];
  networkMode?: 'daily' | 'off';
  collection?: { enabled: boolean; paused: boolean };
  nextCursor?: string | null;
  historyMode?: 'anonymous' | 'optional-consent';
};
