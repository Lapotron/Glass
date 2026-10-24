import { z } from 'zod';
export const mediaProtectionSchema = z
  .object({
    discourageIndexing: z.boolean().default(true),
    blockForeignEmbeds: z.boolean().default(false),
    allowedHosts: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .max(253)
          .refine((value) => {
            try {
              const url = new URL('https://' + value);
              return (
                url.hostname === value &&
                !url.port &&
                url.pathname === '/' &&
                !url.search &&
                !url.hash &&
                !url.username &&
                !url.password &&
                value.includes('.')
              );
            } catch {
              return false;
            }
          }, 'Use a hostname without a scheme, port or path.'),
      )
      .max(20)
      .default([]),
  })
  .default(() => ({ discourageIndexing: true, blockForeignEmbeds: false, allowedHosts: [] }));
export type MediaProtectionReview = {
  id: string;
  revision: string;
  checkedAt: string;
  changes: { zone: string; phase: string; enabled: boolean; existing: boolean }[];
};
export type MediaProtectionStatus = {
  appliedAt: string;
  current: boolean;
  rules: { zone: string; phase: string; id: string; enabled: boolean }[];
};
