/** Import payload counters exclude compression, TAR headers and base64 overhead. */
export type BackupImportProgress = {
  stage: 'preparing' | 'transferring' | 'checking' | 'reviewing' | 'ready';
  totalBytes: number;
  completedBytes: number;
  uploadedBytes: number;
  reusedBytes: number;
  totalFiles: number;
  completedFiles: number;
  currentFile: string;
  elapsedMs: number;
};
