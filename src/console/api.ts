import { t, type UiParams } from '../shared/i18n.js';
import type { SiteConfig, Library, PublicEntry, Job } from '../shared/contracts.js';
export type Bootstrap = {
  projects?: import('../shared/projects.js').Projects;
  projectsRevision?: string;
  workspaceId: string;
  about: import('../shared/contracts.js').PageDocument;
  site: SiteConfig;
  library: Library;
  entries: PublicEntry[];
  siteRevision: string;
  libraryRevision: string;
  token: string;
  jobs: Job[];
  runtime?: {
    mode: 'cloud';
    preview: boolean;
    studioOrigin: string;
    siteOrigin: string;
    buildsConfigured?: boolean;
    busy?: boolean;
    pulse?: string;
  };
};
let sessionToken = '';
let cloudRuntime = false;
let backupDownloadsInstalled = false;
export const isCloudStudio = () => cloudRuntime;
export const cloudSessionToken = () => sessionToken;
let workspaceId = '';
let refreshingSession: Promise<Bootstrap> | undefined;
export const workspacePreferenceKey = (name: string) =>
  `fieldnotes-${workspaceId || 'local'}-${name}`;
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export type CloudJobProgress = { id: string; state: string; bytes?: number; totalBytes?: number };
export type ApiOptions = RequestInit & {
  onCloudProgress?: (progress: CloudJobProgress) => void;
};
export async function api<T = any>(url: string, options: ApiOptions = {}): Promise<T> {
  const { onCloudProgress, ...requestOptions } = options;
  const form = options.body instanceof FormData;
  if (
    cloudRuntime &&
    options.method === 'POST' &&
    (url === 'media' || /^media\/[a-f0-9-]+\/variants$/.test(url))
  ) {
    const { uploadCloudMedia } = await import('./cloud-media-upload.js');
    return uploadCloudMedia(url, options) as Promise<T>;
  }
  if (cloudRuntime && /^media\/(?:[a-f0-9-]+\/)?inspect$/.test(url)) {
    const { inspectCloudImage } = await import('./cloud-image.js');
    return (await inspectCloudImage(url, options)) as T;
  }
  if (
    cloudRuntime &&
    [
      'preview',
      'authoring/math-preview',
      'authoring/component-preview',
      'authoring/validate',
      'authoring/capabilities',
    ].includes(url)
  ) {
    const { cloudPreview } = await import('./cloud-preview.js');
    options.signal?.throwIfAborted();
    return cloudPreview(
      url,
      typeof options.body === 'string' ? JSON.parse(options.body) : {},
      options.signal || undefined,
    );
  }
  const request = async (retrySession: boolean): Promise<T> => {
    const originalWorkspace = workspaceId;
    const response = await fetch(`/api/${url}`, {
      ...requestOptions,
      headers: {
        ...(form ? {} : { 'Content-Type': 'application/json' }),
        'X-Studio-Token': sessionToken,
        ...options.headers,
      },
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        cloudRuntime
          ? 'Your cloud session may need renewal. Open Studio in another tab, sign in, then retry; keep this tab open to preserve your draft.'
          : response.status === 404
            ? 'This Studio API is unavailable (404). Restart Studio after updating, then retry.'
            : `Studio returned an unreadable response (${response.status}). Restart Studio, then retry.`,
        response.status,
      );
    }
    if (!data || typeof data !== 'object')
      throw new ApiError(
        'Studio returned an invalid response. Restart Studio, then retry.',
        response.status,
      );
    if (
      retrySession &&
      originalWorkspace &&
      response.status === 403 &&
      data.error === 'Your Studio session expired. Reload this page.'
    ) {
      // Authentication failed before the mutation ran. Keep drafts across a same-notebook restart.
      refreshingSession ||= api<Bootstrap>('bootstrap').finally(() => {
        refreshingSession = undefined;
      });
      const fresh = await refreshingSession;
      if (fresh.workspaceId !== originalWorkspace) {
        workspaceId = originalWorkspace;
        sessionToken = '';
        throw new ApiError(
          'Studio switched notebooks. Your draft was kept; reopen the correct notebook before saving.',
          409,
        );
      }
      return request(false);
    }
    if (response.status === 202 && data.cloudJob) {
      const id = data.cloudJob;
      onCloudProgress?.({ id, state: data.state || 'queued' });
      for (;;) {
        options.signal?.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException('Cancelled', 'AbortError'));
          };
          const timer = setTimeout(() => {
            options.signal?.removeEventListener('abort', abort);
            resolve();
          }, 2000);
          options.signal?.addEventListener('abort', abort, { once: true });
        });
        const job = await api('cloud-jobs/' + id, { signal: options.signal });
        onCloudProgress?.({ id, state: job.state });
        if (job.state === 'failed') throw new ApiError(job.error || 'Cloud job failed.', 400);
        if (job.state === 'succeeded') {
          const result = await api('cloud-jobs/' + id + '/result', { signal: options.signal });
          if (result.status >= 400)
            throw new ApiError(result.body?.error || 'Cloud operation failed.', result.status);
          return result.body;
        }
      }
    }
    if (response.status === 202 && data.nativeOperation)
      return completeNativeOperation(data.nativeOperation, options);
    if (!response.ok)
      throw new ApiError(
        t(
          data.messageKey || data.error || 'The request could not be completed.',
          data.messageParams as UiParams | undefined,
        ),
        response.status,
      );
    if (cloudRuntime && data.legacyBackup) {
      const { importCloudBackup } = await import('./cloud-backup.js');
      return importCloudBackup(data.legacyBackup, {
        signal: options.signal || new AbortController().signal,
        progress: (bytes) =>
          options.onCloudProgress?.({
            id: data.legacyBackup.id,
            state: 'checking',
            bytes,
            totalBytes: data.legacyBackup.bytes,
          }),
      }) as Promise<T>;
    }
    if (data.runtime?.mode === 'cloud') {
      cloudRuntime = true;
      if (!backupDownloadsInstalled) {
        backupDownloadsInstalled = true;
        document.addEventListener('click', (event) => {
          if (event.defaultPrevented || !(event.target instanceof Element)) return;
          const link = event.target.closest<HTMLAnchorElement>('a[download]'),
            url = link && new URL(link.href, location.href),
            match =
              url?.origin === location.origin &&
              /^\/api\/backups\/([\w-]+)\/download$/.exec(url.pathname);
          if (!match) return;
          event.preventDefault();
          void import('./cloud-backup.js').then((module) => module.downloadCloudBackup(match[1]));
        });
      }
      const { setCloudPreviewModel } = await import('./cloud-preview.js');
      setCloudPreviewModel(data);
      const { cloudReaderLinks } = await import('./cloud-links.js');
      cloudReaderLinks(data.runtime.siteOrigin);
    }
    if (data.token) sessionToken = data.token;
    if (data.workspaceId) workspaceId = data.workspaceId;
    return data;
  };
  return request(true);
}
export async function completeNativeOperation(id: string, options: ApiOptions = {}): Promise<any> {
  const base = 'cloud/operations/' + id,
    plan = await api(base, { signal: options.signal });
  if (plan.state === 'complete') return plan.result;
  options.onCloudProgress?.({ id, state: 'uploading' });
  // Each staged request stays inside the free Worker limit. Visibility changes once, at commit.
  for (const file of plan.files) {
    options.signal?.throwIfAborted();
    if (file.data === null) continue;
    const value = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
    await api(base + '/file?' + new URLSearchParams({ path: file.path }), {
      method: 'PUT',
      body: new Blob([value]),
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: options.signal,
    });
  }
  return api(base + '/commit', { method: 'POST', body: '{}', signal: options.signal });
}
export const send = <T = any>(
  url: string,
  method: string,
  body: unknown,
  options: ApiOptions = {},
) => api<T>(url, { ...options, method, body: JSON.stringify(body) });
export const metadataOf = (entry: PublicEntry) => {
  const { body: _body, revision: _revision, kind: _kind, ...metadata } = entry;
  return metadata;
};
export type MediaFile = import('../shared/contracts.js').MediaAsset;
