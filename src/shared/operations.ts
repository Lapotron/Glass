import { z } from 'zod';
import { photoSchema } from './contracts.js';
export const selectedItemsSchema = z
  .array(
    z
      .object({ id: z.string().min(1).max(1000), revision: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
  )
  .min(1)
  .max(500)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Choose each item once.',
  );
export type SelectedItem = z.infer<typeof selectedItemsSchema>[number];
export const contentBatchSchema = z
  .object({
    items: selectedItemsSchema,
    action: z.enum([
      'trash',
      'duplicate',
      'status',
      'tags',
      'featured',
      'comments',
      'clearAliases',
      'convert',
    ]),
    status: z.enum(['draft', 'scheduled', 'published']).optional(),
    publishAt: z.string().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    tagMode: z.enum(['add', 'remove']).optional(),
    enabled: z.boolean().optional(),
    targetKind: z.enum(['posts', 'lab']).optional(),
    slugs: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type ContentBatch = z.infer<typeof contentBatchSchema>;
export type EntryTrashItem = SelectedItem & {
  title: string;
  kind: 'posts' | 'lab';
  file: string;
  deletedAt: string;
};
export const photoTrashRecordSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^photo-[a-f0-9-]{36}$/),
    kind: z.literal('photos'),
    photo: photoSchema,
    position: z.number().int().nonnegative(),
    deletedAt: z.iso.datetime(),
  })
  .strict();
export type PhotoTrashItem = z.infer<typeof photoTrashRecordSchema> &
  SelectedItem & {
    title: string;
  };
export type TrashItem = EntryTrashItem | PhotoTrashItem;
export type OperationIssue = { id: string; message: string };
export const backupSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  keepAutomatic: z.number().int().min(1).max(100).default(14),
  lastSuccess: z.string().default(''),
  lastAttempt: z.string().default(''),
  error: z.string().default(''),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export type MediaReference = {
  id: string;
  scope: 'current' | 'history';
  kind:
    | 'project'
    | 'entry'
    | 'about'
    | 'setting'
    | 'photo'
    | 'album'
    | 'revision'
    | 'trash'
    | 'photo-trash'
    | 'collection-history'
    | 'about-history';
  title: string;
  context: string;
  source: string;
  line?: number;
  field?: string;
  status?: 'draft' | 'scheduled' | 'published';
  href?: string;
  entryId?: string;
  view:
    | 'media'
    | 'projects'
    | 'writing'
    | 'lab'
    | 'about'
    | 'photos'
    | 'appearance'
    | 'settings'
    | 'trash';
  tab?: string;
};
export type MediaUsage = {
  url: string;
  name: string;
  bytes: number;
  active: string[];
  history: string[];
  missing: boolean;
  references?: MediaReference[];
  referenceCount?: number;
  referencesTruncated?: boolean;
};
/** Recovery-only gaps must not look like broken references in the current notebook. */
export function missingMediaReferences(items: readonly MediaUsage[]) {
  const current: MediaUsage[] = [],
    recovery: MediaUsage[] = [];
  for (const item of items) {
    if (!item.missing) continue;
    if (!item.active.length && item.history.length) recovery.push(item);
    else current.push(item);
  }
  return { current, recovery };
}
export type MaintenanceSummary = {
  /** Cloud mode can show inventory before a deliberate, potentially expensive reference audit. */
  auditPending?: boolean;
  latestBackup: string;
  backupBytes: number;
  mediaBytes: number;
  /** Missing files referenced by current content, including drafts and settings. */
  missing: number;
  missingRecovery?: number;
  unused: number;
  lastBuild: string;
  changedSinceBuild: boolean;
  error?: string;
};
