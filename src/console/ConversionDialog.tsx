import { useEffect, useState } from 'react';
import { t } from '../shared/i18n.js';
import { slugSchema, type PublicEntry } from '../shared/contracts.js';
import { routeFor, type CollectionsConfig } from '../shared/collections.js';
import { validateEntryRoutes } from '../shared/entry-routes.js';
import { Button, Icon } from '../shared/ui.js';
import { Modal, Field, ErrorBox } from './components.js';
import { api, send, type Bootstrap } from './api.js';

export function ConversionDialog({
  entries,
  collections,
  onClose,
  onConverted,
}: {
  entries: PublicEntry[];
  collections: CollectionsConfig;
  onClose: () => void;
  onConverted: (entries: PublicEntry[]) => Promise<void> | void;
}) {
  const [target, setTarget] = useState<'posts' | 'lab'>(
    entries[0]?.kind === 'posts' ? 'lab' : 'posts',
  );
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [notebook, setNotebook] = useState<Bootstrap>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<Bootstrap>('bootstrap')
      .then((value) => {
        if (alive) setNotebook(value);
      })
      .catch((error) => {
        if (alive) setError(error.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  const converted = entries.filter((entry) => entry.kind !== target),
    ids = new Set(entries.map((entry) => entry.id));
  let issue = '';
  if (notebook) {
    if (
      entries.some(
        (entry) =>
          notebook.entries.find((current) => current.id === entry.id)?.revision !== entry.revision,
      )
    )
      issue = t('A selected entry changed. Close this review and select it again.');
    const candidate = entries.map((entry) => ({
      ...entry,
      kind: target,
      slug: entry.kind === target ? entry.slug : (slugs[entry.id] ?? entry.slug),
      file: 'review.md',
    }));
    if (candidate.some((entry) => !slugSchema.safeParse(entry.slug).success))
      issue = t('Use words separated by hyphens for each destination slug.');
    if (!issue)
      try {
        validateEntryRoutes(
          [
            ...notebook.entries
              .filter((entry) => !ids.has(entry.id))
              .map((entry) => ({ ...entry, file: 'review.md' })),
            ...candidate,
          ],
          notebook.site.collections,
        );
      } catch (error) {
        issue = (error as Error).message;
      }
  }
  async function convert() {
    if (busy || issue || !notebook || !converted.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await send<{ entries: PublicEntry[] }>('content/batch', 'POST', {
        action: 'convert',
        items: entries.map(({ id, revision }) => ({ id, revision })),
        targetKind: target,
        slugs,
      });
      await onConverted(result.entries);
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Move between collections')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="primary"
            icon="MoveHorizontal"
            disabled={busy || !notebook || !!issue || !converted.length}
            onClick={() => void convert()}
          >
            {busy ? t('Moving entries…') : t('Move {value0} entries', { value0: converted.length })}
          </Button>
        </>
      }
    >
      <p className="modal-intro">
        {t(
          'Keep the same content identity, history, short links, and conversations. Former article URLs redirect to the new location after the next build.',
        )}
      </p>
      <Field label={t('Destination collection')}>
        <select
          disabled={busy}
          value={target}
          onChange={(event) => setTarget(event.target.value as 'posts' | 'lab')}
        >
          <option value="posts">{collections.posts.name}</option>
          <option value="lab">{collections.lab.name}</option>
        </select>
      </Field>
      <div className="conversion-review">
        {entries.map((entry) => (
          <section key={entry.id} className="conversion-entry">
            <strong>{entry.title}</strong>
            <span className="conversion-origin">
              <code>{routeFor(entry, collections)}</code>
              <Icon name="ArrowDown" size={13} />
            </span>
            {entry.kind === target ? (
              <p className="help">{t('Already in the destination collection; kept unchanged.')}</p>
            ) : (
              <Field label={t('Destination slug')}>
                <input
                  value={slugs[entry.id] ?? entry.slug}
                  disabled={busy}
                  onChange={(event) =>
                    setSlugs((current) => ({ ...current, [entry.id]: event.target.value }))
                  }
                />
              </Field>
            )}
            <code className="conversion-destination">
              {routeFor({ kind: target, slug: slugs[entry.id] ?? entry.slug }, collections)}
            </code>
          </section>
        ))}
      </div>
      {!notebook && !error && <p role="status">{t('Checking selected entries…')}</p>}
      <ErrorBox error={error || issue} />
    </Modal>
  );
}
