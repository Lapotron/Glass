export type ResetRecovery = {
  id: string;
  createdAt: string;
  bytes: number;
  url: string;
};
export type NotebookResetReview = {
  id: string;
  sourceRevision: string;
  expiresAt: string;
  siteName: string;
  counts: {
    posts: number;
    lab: number;
    photos: number;
    albums: number;
    projects?: number;
    media: number;
    trash: number;
    revisions: number;
    backups: number;
    builds: number;
  };
  keptMedia: string[];
  backupBytes: number;
  backupUrl: string;
};
export type NotebookResetResult = {
  recovery: ResetRecovery;
  counts: NotebookResetReview['counts'];
};
