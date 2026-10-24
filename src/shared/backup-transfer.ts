import { z } from 'zod';

export const BACKUP_CHUNK_BYTES = 8 * 1024 ** 2;
export const LARGE_BACKUP_BYTES = 4 * 1024 ** 3;
export const LARGE_BACKUP_EXPANDED_BYTES = 8 * 1024 ** 3;
export const BACKUP_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const backupUploadSchema = z.object({
  name: z.string().min(1).max(200),
  bytes: z.number().int().min(1).max(LARGE_BACKUP_BYTES),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BackupUploadInput = z.infer<typeof backupUploadSchema>;
export type BackupUploadPart = { part: number; bytes: number; sha256: string; etag?: string };
export type BackupUpload = BackupUploadInput & {
  id: string;
  chunkBytes: number;
  parts: BackupUploadPart[];
  expiresAt: string;
  state: 'uploading' | 'ready' | 'cancelled';
  jobId?: string;
  jobState?: string;
  error?: string;
};
export const backupPartBytes = (bytes: number, part: number) => {
  if (!Number.isInteger(part) || part < 1 || part > Math.ceil(bytes / BACKUP_CHUNK_BYTES))
    throw new Error('Invalid backup upload part.');
  return Math.min(BACKUP_CHUNK_BYTES, bytes - (part - 1) * BACKUP_CHUNK_BYTES);
};
