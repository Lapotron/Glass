import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { Button, Icon, EmptyState } from '../shared/ui.js';
import { routeFor, type PublicEntry } from '../shared/contracts.js';
import { shortLinkPath } from '../shared/shortlinks.js';
import type { CollectionsConfig } from '../shared/collections.js';
import { send, metadataOf } from './api.js';
import { PageHeading, Field, ErrorBox, CopyButton } from './components.js';
import {
  BatchDialog,
  useSelection,
  SelectionCheck,
  SelectionToolbar,
  PageSelection,
  Pagination,
} from './Selection.js';
export function ShortLinks({
  entries,
  siteUrl,
  collections,
  onChanged,
  onOpen,
}: {
  entries: PublicEntry[];
  siteUrl: string;
  collections: CollectionsConfig;
  onChanged: () => Promise<void>;
  onOpen: (entry: PublicEntry) => void;
}) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<PublicEntry>(),
    [aliases, setAliases] = useState(''),
    [clearing, setClearing] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const selection = useSelection(entries, query + '|' + kind);
  useEffect(() => {
    setPage(1);
  }, [query, kind]);
  const matching = entries.filter(
    (entry) =>
      (kind === 'all' || entry.kind === kind) &&
      `${entry.title} ${entry.shortCode} ${entry.shortAliases.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(matching.length / 25))),
    shown = matching.slice((current - 1) * 25, current * 25);
  const shortUrl = (entry: PublicEntry) => new URL(shortLinkPath(entry), siteUrl).href;
  const selected = entries.filter((entry) => selection.has(entry.id));
  const csv = () => {
    const quote = (value: string) =>
      '"' + (/^[=+@-]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"';
    const text = [
      ['Title', 'Kind', 'Short link', 'Destination', 'Status'],
      ...selected.map((entry) => [
        entry.title,
        collections[entry.kind].singular,
        shortUrl(entry),
        new URL(routeFor(entry, collections), siteUrl).href,
        entry.status,
      ]),
    ]
      .map((row) => row.map(quote).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'short-links.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return (
    <div className="studio-page">
      <PageHeading
        eyebrow={t("Small links, stable destinations")}
        title={t("A shorter way here.")}
        description={t("Automatic links follow entry IDs through title and URL changes. Custom aliases share the /s/ namespace.")}
      />
      <div className="managed-filters">
        <div className="search-field">
          <Icon name="Search" size={15} />
          <input
            type="search"
            aria-label={t("Search short links")}
            placeholder={t("Find an entry or alias…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
           data-ui-attrs={"{\"aria-label\":\"Search short links\",\"placeholder\":\"Find an entry or alias…\"}"} />
        </div>
        <select
          aria-label={t("Filter short-link collection")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
         data-ui-attrs={"{\"aria-label\":\"Filter short-link collection\"}"} >
          <option value="all">
            {collections.posts.name} <UiText message={" and "}/>{collections.lab.name}
          </option>
          <option value="posts">{collections.posts.name}</option>
          <option value="lab">{collections.lab.name}</option>
        </select>
      </div>
      <ErrorBox error={error} />
      {message && (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}
      <SelectionToolbar selection={selection} matching={matching}>
        <Button
          className="small"
          icon="Copy"
          onClick={() => {
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(selected.map(shortUrl).join('\n')))
              .then(() => setMessage('Short links copied.'))
              .catch(() => setError('Copy is unavailable. Export the links as CSV instead.'));
          }}
        >
          <UiText message={"Copy selected URLs"}/></Button>
        <Button className="small" icon="Download" onClick={csv}>
          <UiText message={"Export links CSV"}/></Button>
        <Button className="small" icon="X" onClick={() => setClearing(true)}>
          <UiText message={"Clear custom aliases"}/></Button>
      </SelectionToolbar>
      <section className="managed-list glass-panel">
        <div className="managed-list-head">
          <PageSelection selection={selection} items={shown} />
          <span data-ui={"Active after Build & Publish"}>{t("Active after Build & Publish")}</span>
        </div>
        {shown.map((entry) => (
          <div className="managed-entry-row shortlink-row" key={entry.id}>
            <SelectionCheck
              label={'Select short link ' + entry.title}
              checked={selection.has(entry.id)}
              onChange={() => selection.toggle(entry)}
            />
            <div className="shortlink-cell">
              <button className="managed-entry-open" onClick={() => onOpen(entry)}>
                <strong>{entry.title}</strong>
              </button>
              <code>{shortUrl(entry)}</code>
              <small className="small-caption">
                {entry.shortAliases.length
                  ? entry.shortAliases.map((alias) => '/s/' + alias).join(' · ')
                  : t("No custom aliases")}
              </small>
            </div>
            <span className={'badge ' + entry.status}>
              {entry.status === 'published' ? t("Active on build") : t("Inactive")}
            </span>
            <Button
              className="small"
              icon="LinkIcon"
              onClick={() => {
                setEditing(entry);
                setAliases(entry.shortAliases.join(', '));
              }}
            >
              <UiText message={"Edit aliases"}/></Button>
            <CopyButton value={shortUrl(entry)} label={t("Copy")} />
          </div>
        ))}
        {!shown.length && (
          <EmptyState icon="LinkIcon" title={t("No matching short links")}>
            <UiText message={"Every saved entry receives a stable short link."}/></EmptyState>
        )}
        <Pagination page={current} total={matching.length} size={25} onPage={setPage} />
      </section>
      {editing && (
        <BatchDialog
          title={t("Edit short-link aliases")}
          names={[editing.title]}
          confirmLabel="Save aliases"
          onClose={() => setEditing(undefined)}
          onConfirm={async () => {
            await send('content/' + editing.id, 'PUT', {
              metadata: {
                ...metadataOf(editing),
                shortAliases: aliases
                  .split(',')
                  .map((alias) => alias.trim())
                  .filter(Boolean),
              },
              body: editing.body,
              revision: editing.revision,
            });
            await onChanged();
          }}
        >
          <Field label={t("Primary short link")}>
            <input readOnly value={shortUrl(editing)} />
          </Field>
          <Field
            label={t("Custom aliases")}
            help={t("Up to 10 comma-separated aliases. Use 3–32 lowercase letters, digits, hyphens or underscores.")}
          >
            <input value={aliases} onChange={(event) => setAliases(event.target.value)} />
          </Field>
          <p className="help" data-ui={"Alias changes take effect after Build & Publish."}>{t("Alias changes take effect after Build & Publish.")}</p>
        </BatchDialog>
      )}
      {clearing && (
        <BatchDialog
          title={t("Clear selected custom aliases?")}
          names={selected.map((entry) => entry.title)}
          confirmLabel="Clear aliases"
          onClose={() => setClearing(false)}
          onConfirm={async () => {
            await send('content/batch', 'POST', { action: 'clearAliases', items: selection.items });
            selection.clear();
            await onChanged();
          }}
        >
          <p className="help" data-ui={"Primary short links remain available. Previous aliases remain recoverable in entry revisions."}>
            {t("Primary short links remain available. Previous aliases remain recoverable in entry revisions.")}</p>
        </BatchDialog>
      )}
    </div>
  );
}
