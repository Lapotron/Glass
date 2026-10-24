export type CloudMediaObject = {
  key: string;
  bytes: number;
  sha256: string;
  modifiedAt: string;
  protected: boolean;
  owned: boolean;
  duplicate: boolean;
  eligible: boolean;
  reason: string;
};
export type CloudMediaInventory = {
  revision: string;
  checkedAt: string;
  bucket: string;
  prefix: string;
  objects: CloudMediaObject[];
  totalBytes: number;
  duplicateBytes: number;
  blockers: string[];
  duplicateGroups: number;
};
export type CloudMediaReview = {
  id: string;
  revision: string;
  keys: string[];
  bytes: number;
  expiresAt: string;
};
