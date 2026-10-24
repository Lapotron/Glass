import { z } from 'zod';
import { mathExtensions } from './math-catalog.js';
export * from './math-catalog.js';

export const mathSettingsSchema = z.object({
  packages: z
    .array(z.enum(mathExtensions))
    .max(mathExtensions.length)
    .transform((values) => [...new Set(values)])
    .default([]),
});
