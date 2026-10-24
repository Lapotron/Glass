import { canSaveToolDraft, isToolId, toolLimits, type ToolId } from '../../shared/tools-catalog.js';
export type DraftId = ToolId | 'equation';
export type ToolDraft = {
  id: DraftId;
  source: string;
  options: Record<string, string>;
  updated: number;
};
type Preferences = { favorites: ToolId[] };
const preferenceKey = 'glass-tools-preferences-v1';
export function readToolPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    return {
      favorites: Array.isArray(value.favorites)
        ? value.favorites
            .filter((id: unknown): id is ToolId => typeof id === 'string' && isToolId(id))
            .slice(0, 15)
        : [],
    };
  } catch {
    return { favorites: [] };
  }
}
export function saveToolPreferences(value: Preferences) {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(value));
  } catch {
    /* Preferences are optional. */
  }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Local draft storage is unavailable.'));
      return;
    }
    const request = indexedDB.open('glass-tools-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onerror = () => reject(new Error('Local draft storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other Tools tabs and retry.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode),
      request = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => {
      resolve(request.result);
      db.close();
    };
    tx.onabort = tx.onerror = () => {
      reject(new Error('Local draft storage is unavailable.'));
      db.close();
    };
  });
}
export async function readToolDraft(id: DraftId): Promise<ToolDraft | undefined> {
  if (!canSaveToolDraft(id)) return;
  const value = await transaction<ToolDraft | undefined>('readonly', (store) => store.get(id));
  if (
    !value ||
    typeof value.source !== 'string' ||
    value.source.length > toolLimits.textBytes ||
    !value.options ||
    typeof value.options !== 'object' ||
    Array.isArray(value.options) ||
    Object.entries(value.options).some(
      ([key, value]) =>
        key.length > 64 ||
        typeof value !== 'string' ||
        value.length > (key === 'after' ? toolLimits.textBytes : 16384),
    )
  )
    return;
  return value;
}
export async function writeToolDraft(value: ToolDraft) {
  if (!canSaveToolDraft(value.id)) throw new Error('This tool does not save sensitive content.');
  if (new TextEncoder().encode(value.source).length > toolLimits.textBytes)
    throw new Error('Text inputs support up to 1 MiB.');
  await transaction('readwrite', (store) => store.put(value));
}
export async function deleteToolDraft(id: DraftId) {
  await transaction('readwrite', (store) => store.delete(id));
}
export async function clearToolDrafts() {
  await transaction('readwrite', (store) => store.clear());
}
