import { z } from 'zod';
import { shortLinkPattern } from './shortlinks.js';
export const mediaMetadataSchema = z.object({
  publishCameraExif: z.boolean().default(false),
  displayName: z
    .string()
    .trim()
    .max(180)
    .regex(/^[^\p{Cc}/\\]*$/u, 'Use a name without slashes or control characters.')
    .default(''),
  shortCode: z.union([z.literal(''), z.string().regex(shortLinkPattern)]).default(''),
  shortAliases: z.array(z.string().regex(shortLinkPattern)).max(10).default([]),
  publishForSharing: z.boolean().default(false),
});
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;
export type MediaMetadataResponse = {
  url: string;
  name: string;
  metadata: MediaMetadata;
  shortPath: string;
  downloadName: string;
  libraryRevision: string;
};
export function mediaDownloadName(filename: string, label = '') {
  if (!label.trim()) return filename;
  const extension = filename.match(/\.[a-z0-9]+$/i)?.[0] || '';
  const safe =
    label
      .replace(/[\p{Cc}/\\:*?"<>|]/gu, '-')
      .replace(/[. ]+$/g, '')
      .slice(0, 160) || 'file';
  return safe.toLowerCase().endsWith(extension.toLowerCase()) ? safe : safe + extension;
}
