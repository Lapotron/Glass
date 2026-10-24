import { useEffect, useRef, useState } from 'react';
import { siteSchema, type SiteConfig } from '../shared/contracts.js';
import { ApiError, send } from './api.js';

const aboutScope = {
  keys: ['profile', 'about'],
  label: 'Profile and guestbook',
  changed: 'Profile or guestbook settings changed outside Studio. Your changes are preserved.',
  blocked: 'Reload the latest profile settings before saving. Your About story is separate.',
} as const;
const homeScope = {
  keys: ['home'],
  label: 'Homepage',
  changed: 'Homepage settings changed outside Studio. Your changes are preserved.',
  blocked: 'Reload the latest homepage settings before saving. Your changes are still here.',
} as const;
function useScopedSiteDraft(
  site: SiteConfig,
  sourceRevision: string,
  onSaved: (site: SiteConfig, revision: string) => void,
  scope: { keys: readonly (keyof SiteConfig)[]; label: string; changed: string; blocked: string },
) {
  const owned = (value: SiteConfig) => JSON.stringify(scope.keys.map((key) => value[key]));
  const mergeOwned = (base: SiteConfig, value: SiteConfig): SiteConfig => ({
    ...base,
    ...Object.fromEntries(scope.keys.map((key) => [key, value[key]])),
  });
  const [draft, setDraft] = useState(site),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [error, setError] = useState('');
  const baseline = useRef(site),
    revision = useRef(sourceRevision),
    latest = useRef(draft),
    pending = useRef<Promise<void> | null>(null),
    saving = useRef<string | null>(null);
  const blocked = useRef(false),
    callback = useRef(onSaved);
  callback.current = onSaved;
  latest.current = draft;
  const dirty = owned(draft) !== owned(baseline.current);
  useEffect(() => {
    if (sourceRevision === revision.current || saving.current === owned(site)) return;
    if (
      owned(latest.current) !== owned(baseline.current) &&
      owned(site) !== owned(baseline.current)
    ) {
      blocked.current = true;
      setConflict(true);
      setError(scope.changed);
    } else {
      const next =
        owned(latest.current) === owned(baseline.current) ? site : mergeOwned(site, latest.current);
      baseline.current = site;
      revision.current = sourceRevision;
      latest.current = next;
      setDraft(next);
    }
  }, [sourceRevision]);
  async function save() {
    if (pending.current) await pending.current;
    if (owned(latest.current) === owned(baseline.current)) return;
    if (blocked.current) throw new Error(scope.blocked);
    const submitted = owned(latest.current);
    const value = siteSchema.parse(mergeOwned(baseline.current, latest.current));
    saving.current = owned(value);
    setBusy(true);
    setError('');
    const operation = (async () => {
      try {
        const saved = await send<{ value: SiteConfig; revision: string }>('site', 'PUT', {
          value,
          revision: revision.current,
        });
        baseline.current = saved.value;
        revision.current = saved.revision;
        latest.current =
          owned(latest.current) === submitted
            ? saved.value
            : mergeOwned(saved.value, latest.current);
        setDraft(latest.current);
        callback.current(saved.value, saved.revision);
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          blocked.current = true;
          setConflict(true);
        }
        setError(`${scope.label}: ${(failure as Error).message}`);
        throw failure;
      } finally {
        setBusy(false);
      }
    })();
    pending.current = operation;
    try {
      await operation;
    } finally {
      pending.current = null;
      saving.current = null;
    }
    if (owned(latest.current) !== owned(baseline.current)) await save();
  }
  function reload() {
    baseline.current = site;
    revision.current = sourceRevision;
    latest.current = site;
    setDraft(site);
    blocked.current = false;
    setConflict(false);
    setError('');
  }
  return { draft, setDraft, busy, conflict, error, dirty, save, reload };
}
export function useAboutSiteDraft(
  site: SiteConfig,
  revision: string,
  onSaved: (site: SiteConfig, revision: string) => void,
) {
  return useScopedSiteDraft(site, revision, onSaved, aboutScope);
}
export function useHomeSiteDraft(
  site: SiteConfig,
  revision: string,
  onSaved: (site: SiteConfig, revision: string) => void,
) {
  return useScopedSiteDraft(site, revision, onSaved, homeScope);
}
