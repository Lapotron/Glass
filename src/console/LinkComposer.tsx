import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { useEffect, useState } from 'react';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Button, Icon } from '../shared/ui.js';
import { ErrorBox, Field, Modal, ToggleField } from './components.js';
import { completionTargets, type CompletionTargets } from './markdown-assistance.js';
import { FileLinkPicker, attachmentTitle } from './FileLinkPicker.js';
import { attachmentFile } from '../shared/attachments.js';
import {
  composeLink,
  existingLink,
  linkHeadings,
  localLinkTargets,
  type LinkTarget,
} from './source-links.js';

export function LinkComposer({
  view,
  targets,
  onClose,
}: {
  view: EditorView;
  targets: CompletionTargets;
  onClose: () => void;
}) {
  const [snapshot] = useState(() => {
    const source = view.state.doc.toString(),
      selection = view.state.selection.main,
      existing = existingLink(source, selection.from, selection.to);
    return {
      source,
      range: existing || { from: selection.from, to: selection.to },
      label: existing?.label || source.slice(selection.from, selection.to),
      url: existing?.url || '',
      reference: existing?.reference,
    };
  });
  const [notebook, setNotebook] = useState(targets.notebook),
    [loading, setLoading] = useState(!targets.notebook),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<'url' | 'local' | 'headings' | 'files'>(
      snapshot.url.startsWith('/media/') && attachmentFile(snapshot.url)
        ? 'files'
        : snapshot.url
          ? 'url'
          : 'local',
    ),
    [query, setQuery] = useState(''),
    [label, setLabel] = useState(snapshot.label),
    [url, setUrl] = useState(snapshot.url),
    [style, setStyle] = useState<'inline' | 'reference' | 'citation'>(
      snapshot.reference ? 'reference' : 'inline',
    ),
    [referenceKey, setReferenceKey] = useState(snapshot.reference || '');
  const [target, setTarget] = useState<LinkTarget | undefined>(),
    [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (notebook) return;
    let cancelled = false;
    setLoading(true);
    void completionTargets()
      .then((result) => {
        if (cancelled) return;
        if (!result.notebook)
          throw new Error('Local content could not load. You can still insert a URL.');
        setNotebook(result.notebook);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);
  const choices = notebook ? localLinkTargets(notebook) : [],
    filtered = choices.filter((t) =>
      `${t.title} ${t.url} ${t.group}`.toLowerCase().includes(query.toLowerCase()),
    );
  const headings = linkHeadings(target?.body ?? snapshot.source).filter((h) =>
    h.label.toLowerCase().includes(query.toLowerCase()),
  );
  const unpublished = target && target.status !== 'published';
  const choose = (item: LinkTarget) => {
    setTarget(item);
    setUrl(item.url);
    setAcknowledged(false);
    if (!label) setLabel(item.title);
    setError('');
  };
  const insert = () => {
    try {
      if (view.state.doc.toString() !== snapshot.source)
        throw new Error(
          'The source changed while this dialog was open. Close and reopen it to keep the latest text.',
        );
      if (unpublished && !acknowledged)
        throw new Error('Acknowledge the unpublished destination before inserting it.');
      const edits = composeLink(snapshot.source, snapshot.range, {
        label,
        url,
        style,
        key: referenceKey,
        target,
        siteUrl: notebook?.site.url,
      });
      view.dispatch({
        changes: edits,
        effects: view.scrollSnapshot(),
        annotations: Transaction.userEvent.of('input.link'),
      });
      onClose();
      requestAnimationFrame(() => view.focus());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={snapshot.url ? t("Edit link") : t("Insert link")}
      className="link-composer"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}><UiText message={"Cancel"}/></Button>
          <Button
            variant="primary"
            icon={style === 'citation' ? 'BookOpen' : 'LinkIcon'}
            disabled={!url || (unpublished && !acknowledged) || (style === 'citation' && !target)}
            onClick={insert}
          >
            {style === 'citation'
              ? t("Insert citation")
              : snapshot.url
                ? t("Update link")
                : t("Insert link")}
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      {error && !notebook && (
        <Button className="small" onClick={() => setRetry((n) => n + 1)}>
          <UiText message={"Retry local content"}/></Button>
      )}
      <div className="segmented link-composer-tabs" role="group" aria-label={t("Link destination")} data-ui-attrs={"{\"aria-label\":\"Link destination\"}"} >
        {(['url', 'local', 'headings', 'files'] as const).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setQuery('');
            }}
          >
            <Icon
              name={
                key === 'url'
                  ? 'LinkIcon'
                  : key === 'local'
                    ? 'FileText'
                    : key === 'files'
                      ? 'FolderOpen'
                      : 'ListTree'
              }
              size={15}
            />
            {key === 'url'
              ? t("Web address")
              : key === 'local'
                ? t("Local content")
                : key === 'files'
                  ? t("Files")
                  : t("Headings")}
          </button>
        ))}
      </div>
      {tab === 'files' && (
        <FileLinkPicker
          selected={url}
          onSelect={(file) => {
            setUrl(file.url);
            setTarget(undefined);
            setAcknowledged(false);
            if (!label || label === target?.title) setLabel(attachmentTitle(file.name));
            if (style === 'citation') setStyle('inline');
            setError('');
          }}
        />
      )}
      {tab !== 'url' && tab !== 'files' && (
        <>
          <label className="search-field">
            <Icon name="Search" size={16} />
            <input
              type="search"
              data-modal-focus
              aria-label={t("Search link destinations")}
              placeholder={tab === 'local' ? t("Search entries, pages, albums…") : t("Search headings…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
             data-ui-attrs={"{\"aria-label\":\"Search link destinations\"}"} />
          </label>
          <div
            className="link-target-list"
            role="group"
            aria-label={tab === 'local' ? t("Local destinations") : t("Heading destinations")}
          >
            {tab === 'local' ? (
              loading ? (
                <p className="help" role="status" data-ui={"Loading local content…"}>
                  {t("Loading local content…")}</p>
              ) : filtered.length ? (
                filtered.slice(0, 100).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={target?.id === item.id}
                    onClick={() => choose(item)}
                  >
                    <Icon name={item.group === 'Albums' ? 'Image' : 'FileText'} size={16} />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.group} · {item.status}
                        <br />
                        {item.url}
                      </small>
                    </span>
                    <Icon name="ChevronRight" size={14} />
                  </button>
                ))
              ) : (
                <p className="help" data-ui={"No matching local destinations."}>{t("No matching local destinations.")}</p>
              )
            ) : (
              <>
                <p className="help">
                  {target ? t("Headings in {value0}", {value0: target.title}) : t("Headings in this document")}
                  {target && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setTarget(undefined)}
                     data-ui={"Use this document"}>
                      {t("Use this document")}</button>
                  )}
                </p>
                {headings.length ? (
                  headings.map((h) => (
                    <button
                      type="button"
                      key={h.fragment}
                      onClick={() => {
                        setUrl(`${target?.url || ''}#${h.fragment}`);
                        if (!label) setLabel(h.label);
                      }}
                    >
                      <Icon name="Hash" size={15} />
                      <span>
                        {h.label}
                        <small>#{h.fragment}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="help" data-ui={"No matching headings."}>{t("No matching headings.")}</p>
                )}
              </>
            )}
          </div>
        </>
      )}
      <div className="link-fields">
        <Field label={t("Link text")}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={target?.title || t("Descriptive link text")}
          />
        </Field>
        <Field label={t("Destination")}>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTarget(undefined);
            }}
            placeholder="https://example.com or /page/"
          />
        </Field>
        <Field label={t("Insert as")}>
          <select value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
            <option value="inline" data-ui={"Inline link"}>{t("Inline link")}</option>
            <option value="reference" data-ui={"Reference-style link"}>{t("Reference-style link")}</option>
            <option value="citation" disabled={!target} data-ui={"Bibliography citation to local content"}>
              {t("Bibliography citation to local content")}</option>
          </select>
        </Field>
        {style === 'reference' && (
          <Field
            label={t("Reference key")}
            help={t("Existing definitions with this destination are reused.")}
          >
            <input
              value={referenceKey}
              onChange={(e) => setReferenceKey(e.target.value)}
              placeholder={t("Generated from the link text")}
             data-ui-attrs={"{\"placeholder\":\"Generated from the link text\"}"} />
          </Field>
        )}
      </div>
      {style === 'citation' && (
        <p className="help" data-ui={"Inserts a numbered citation and reuses or adds one bibliography entry with the canonical public URL."}>
          {t("Inserts a numbered citation and reuses or adds one bibliography entry with the canonical public URL.")}</p>
      )}
      {unpublished && (
        <div className="link-unpublished">
          <p>
            <UiText message={"This destination is "}/>{target.status}<UiText message={". Publish it before linking from a public article."}/></p>
          <ToggleField
            label={t("Insert this unpublished destination anyway")}
            checked={acknowledged}
            onChange={setAcknowledged}
          />
        </div>
      )}
    </Modal>
  );
}
