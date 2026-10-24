import { t } from '../shared/i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { ViewUpdate } from '@codemirror/view';
import type { ChangeDesc, Text } from '@codemirror/state';
import { Icon } from '../shared/ui.js';
import { api, workspacePreferenceKey } from './api.js';

export type PreviewSnapshot = { url: string; source: string; identity: string; generation: number };
type SourceChange = { before: string; after: string; changes: ChangeDesc };
export function translateSourcePosition(
  from: string,
  to: string,
  position: number,
  changes: readonly SourceChange[],
) {
  if (from === to) return Math.min(position, to.length);
  let text = from,
    mapped = position;
  for (const change of changes) {
    if (change.before !== text) continue;
    mapped = change.changes.mapPos(Math.min(mapped, change.changes.length), 1);
    text = change.after;
    if (text === to) return Math.min(mapped, to.length);
  }
  // External restores and edits made while the source pane is hidden have no CM transaction.
  let prefix = 0,
    suffix = 0;
  while (prefix < Math.min(from.length, to.length) && from[prefix] === to[prefix]) prefix++;
  while (
    suffix < Math.min(from.length, to.length) - prefix &&
    from[from.length - suffix - 1] === to[to.length - suffix - 1]
  )
    suffix++;
  if (position <= prefix) return position;
  if (position >= from.length - suffix)
    return Math.max(0, Math.min(to.length, position + to.length - from.length));
  return prefix + Math.min(position - prefix, to.length - prefix - suffix);
}

export function useLivePreview({
  identity,
  source,
  request,
  enabled = true,
  delay = 500,
}: {
  identity: string;
  source: string;
  request: unknown;
  enabled?: boolean;
  delay?: number;
}) {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [follow, setFollowState] = useState(() => {
    try {
      return localStorage.getItem(workspacePreferenceKey('follow-preview')) === 'true';
    } catch {
      return false;
    }
  });
  const [position, setPosition] = useState<{ source: string; offset: number } | null>(null);
  const editorPosition = useRef<typeof position>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const textSnapshot = useRef<{ doc: Text; source: string } | null>(null);
  const sourceFor = (doc: Text) => {
    if (textSnapshot.current?.doc === doc) return textSnapshot.current.source;
    const source = doc.toString();
    textSnapshot.current = { doc, source };
    return source;
  };
  const changes = useRef<SourceChange[]>([]),
    sequence = useRef(0);
  const lastSuccess = useRef<{ request: string; identity: string; refresh: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const serialized = JSON.stringify(request);
  useEffect(() => {
    const generation = ++sequence.current;
    if (!enabled) {
      setBusy(false);
      return;
    }
    if (
      lastSuccess.current?.request === serialized &&
      lastSuccess.current.identity === identity &&
      lastSuccess.current.refresh === refreshKey
    ) {
      setBusy(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      void api<{ url: string }>('preview', {
        method: 'POST',
        body: serialized,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
      })
        .then((result) => {
          if (generation !== sequence.current || controller.signal.aborted) return;
          lastSuccess.current = { request: serialized, identity, refresh: refreshKey };
          setSnapshot({ url: result.url, source, identity, generation });
          setError('');
        })
        .catch((failure) => {
          if (generation === sequence.current && !controller.signal.aborted)
            setError(
              failure.name === 'TimeoutError'
                ? 'Preview took too long to render. Your last preview is still here.'
                : failure.message,
            );
        })
        .finally(() => {
          if (generation === sequence.current) setBusy(false);
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serialized, enabled, identity, refreshKey]);
  const onEditorUpdate = (update: ViewUpdate) => {
    if (update.docChanged) {
      changes.current.push({
        before: sourceFor(update.startState.doc),
        after: sourceFor(update.state.doc),
        changes: update.changes.desc,
      });
      if (changes.current.length > 120) changes.current.splice(0, changes.current.length - 120);
    }
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      const offset =
        update.docChanged || update.selectionSet
          ? update.state.selection.main.head
          : update.view.lineBlockAtHeight(update.view.scrollDOM.scrollTop).from;
      editorPosition.current = { source: sourceFor(update.state.doc), offset };
      if (followRef.current) setPosition(editorPosition.current);
    }
  };
  const setFollow = (value: boolean) => {
    setFollowState(value);
    if (value) setPosition(editorPosition.current);
    try {
      localStorage.setItem(workspacePreferenceKey('follow-preview'), String(value));
    } catch {
      /* Storage can be unavailable in private windows. */
    }
  };
  return {
    snapshot,
    busy,
    error,
    follow,
    setFollow,
    position,
    onEditorUpdate,
    changes,
    refresh: () => setRefreshKey((key) => key + 1),
  };
}
export type PreviewController = ReturnType<typeof useLivePreview>;
export function PreviewError({ controller }: { controller: PreviewController }) {
  if (!controller.error) return null;
  return (
    <div className="error-message preview-request-error" role="alert">
      <span>{controller.error}</span>
      <button
        className="button secondary small"
        onClick={controller.refresh}
        disabled={controller.busy}
        data-ui={'Refresh preview'}
      >
        {t('Refresh preview')}
      </button>
    </div>
  );
}
export function FollowEditor({ controller }: { controller: PreviewController }) {
  return (
    <button
      type="button"
      className={`preview-follow${controller.follow ? ' active' : ''}`}
      aria-pressed={controller.follow}
      onClick={() => controller.setFollow(!controller.follow)}
      title={t('Follow source scrolling and the passage being edited')}
      data-ui-attrs={'{"title":"Follow source scrolling and the passage being edited"}'}
    >
      <Icon name="MoveHorizontal" size={13} />
      <span data-ui={'Follow editor'}>{t('Follow editor')}</span>
    </button>
  );
}

type Anchor = {
  source: string;
  start?: number;
  end?: number;
  fraction: number;
  screen: number;
  ratio: number;
};
const sourceBlocks = (doc: Document) =>
  [...doc.querySelectorAll<HTMLElement>('[data-source-start][data-source-end]')].filter(
    (node) => node.getBoundingClientRect().height > 0 && node.getClientRects().length,
  );
const hasGeometry = (frame: HTMLIFrameElement) =>
  frame.getClientRects().length > 0 && frame.clientWidth > 0 && frame.clientHeight > 0;
function capture(frame: HTMLIFrameElement, source: string): Anchor {
  const doc = frame.contentDocument!,
    win = frame.contentWindow!;
  const inset = Math.min(
    (doc.querySelector('.site-header')?.getBoundingClientRect().bottom || 0) + 16,
    win.innerHeight / 3,
  );
  const blocks = sourceBlocks(doc);
  const containing = blocks
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top <= inset && rect.bottom > inset;
    })
    .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
  const block = containing[0] || blocks.find((node) => node.getBoundingClientRect().top >= inset);
  const ratio = win.scrollY / Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
  if (!block || win.scrollY < 2) return { source, fraction: 0, screen: 0, ratio };
  const rect = block.getBoundingClientRect();
  return {
    source,
    start: Number(block.dataset.sourceStart),
    end: Number(block.dataset.sourceEnd),
    fraction: Math.max(0, Math.min(1, (inset - rect.top) / rect.height)),
    screen: Math.max(inset, rect.top),
    ratio,
  };
}
function restore(
  frame: HTMLIFrameElement,
  anchor: Anchor,
  target: string,
  changes: readonly SourceChange[],
) {
  const doc = frame.contentDocument!,
    win = frame.contentWindow!;
  let scroll = anchor.ratio * Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
  if (anchor.start !== undefined) {
    const start = translateSourcePosition(anchor.source, target, anchor.start, changes);
    const end = translateSourcePosition(anchor.source, target, anchor.end ?? anchor.start, changes);
    const blocks = sourceBlocks(doc);
    const exact = blocks.find(
      (node) =>
        Number(node.dataset.sourceStart) === start && Number(node.dataset.sourceEnd) === end,
    );
    const block =
      exact ||
      blocks.sort(
        (a, b) =>
          Math.abs(Number(a.dataset.sourceStart) - start) -
          Math.abs(Number(b.dataset.sourceStart) - start),
      )[0];
    if (block) {
      const rect = block.getBoundingClientRect();
      scroll = win.scrollY + rect.top + anchor.fraction * rect.height - anchor.screen;
    }
  }
  win.scrollTo({ left: 0, top: Math.max(0, scroll), behavior: 'instant' });
}

/** Stage new documents offscreen; only reveal a rendered document after restoring its anchor. */
export function LivePreview({
  controller,
  title,
  identity,
  className = '',
}: {
  controller: PreviewController;
  title: string;
  identity: string;
  className?: string;
}) {
  const [active, setActive] = useState<PreviewSnapshot | null>(null);
  const [frameError, setFrameError] = useState('');
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const current = useRef<PreviewSnapshot | null>(null);
  const saved = useRef<Anchor | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef(controller);
  latest.current = controller;
  const applying = useRef(false);
  const requestIdentity = useRef(identity);
  requestIdentity.current = identity;
  const snapshot = controller.snapshot?.identity === identity ? controller.snapshot : null;
  const incoming = snapshot && snapshot.url !== active?.url ? snapshot : null;
  const visible = active?.identity === identity ? active : null;
  const list = visible ? [visible, ...(incoming ? [incoming] : [])] : incoming ? [incoming] : [];
  const follow = (frame: HTMLIFrameElement, item: PreviewSnapshot) => {
    const position = latest.current.position;
    if (!latest.current.follow || !position || position.source !== item.source) return false;
    const blocks = sourceBlocks(frame.contentDocument!);
    const block = blocks
      .filter(
        (node) =>
          Number(node.dataset.sourceStart) <= position.offset &&
          Number(node.dataset.sourceEnd) >= position.offset,
      )
      .sort(
        (a, b) =>
          Number(a.dataset.sourceEnd) -
          Number(a.dataset.sourceStart) -
          (Number(b.dataset.sourceEnd) - Number(b.dataset.sourceStart)),
      )[0];
    if (!block) return false;
    applying.current = true;
    frame.contentWindow!.scrollTo({
      top: frame.contentWindow!.scrollY + block.getBoundingClientRect().top - 100,
      behavior: 'instant',
    });
    requestAnimationFrame(() => {
      applying.current = false;
    });
    return true;
  };
  useEffect(() => {
    if (current.current?.identity !== identity) {
      cleanup.current?.();
      current.current = null;
      saved.current = null;
      setActive(null);
    }
  }, [identity]);
  useEffect(() => {
    if (active) {
      const frame = frames.current.get(active.url);
      if (frame && frame.contentDocument?.readyState === 'complete' && follow(frame, active))
        saved.current = capture(frame, active.source);
    }
  }, [controller.position, controller.follow]);
  useEffect(() => () => cleanup.current?.(), []);
  const ready = async (frame: HTMLIFrameElement, item: PreviewSnapshot) => {
    if (item.identity !== requestIdentity.current || latest.current.snapshot?.url !== item.url)
      return;
    const doc = frame.contentDocument;
    if (!doc || !doc.querySelector('[data-preview]')) {
      setFrameError('This preview could not be loaded. Refresh it to try again.');
      return;
    }
    setFrameError('');
    const style = doc.createElement('style');
    style.textContent = 'html{scroll-behavior:auto!important}html::before{display:none!important}';
    doc.head.append(style);
    await doc.fonts.ready;
    if (latest.current.snapshot?.url !== item.url || !frame.isConnected) return;
    const old = current.current && frames.current.get(current.current.url);
    const anchor =
      old?.contentDocument && hasGeometry(old) && current.current
        ? capture(old, current.current.source)
        : saved.current;
    cleanup.current?.();
    applying.current = true;
    if (!follow(frame, item) && anchor)
      restore(frame, anchor, item.source, latest.current.changes.current);
    saved.current = capture(frame, item.source);
    current.current = item;
    setActive(item);
    requestAnimationFrame(() => {
      applying.current = false;
    });
    const win = frame.contentWindow!;
    let animation = 0;
    const remember = () => {
      // Scroll events run before animation frames. Record a reader's scroll even when it
      // lands between a restored document's first layout and its resize observer callback.
      if (hasGeometry(frame)) saved.current = capture(frame, item.source);
    };
    const reposition = () => {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        if (!saved.current || applying.current || !hasGeometry(frame)) return;
        applying.current = true;
        restore(frame, saved.current, item.source, latest.current.changes.current);
        saved.current = capture(frame, item.source);
        requestAnimationFrame(() => {
          applying.current = false;
        });
      });
    };
    win.addEventListener('scroll', remember, { passive: true });
    win.addEventListener('resize', reposition);
    const resize = new ResizeObserver(reposition);
    resize.observe(doc.body);
    cleanup.current = () => {
      win.removeEventListener('scroll', remember);
      win.removeEventListener('resize', reposition);
      resize.disconnect();
      cancelAnimationFrame(animation);
    };
  };
  return (
    <div className={`live-preview ${className}`} data-preview-ready={Boolean(visible)}>
      {list.map((item) => (
        <iframe
          key={item.url}
          ref={(node) => {
            if (node) frames.current.set(item.url, node);
            else frames.current.delete(item.url);
          }}
          title={
            visible?.url === item.url
              ? title
              : t('Preparing {value0}', { value0: title.toLowerCase() })
          }
          src={item.url}
          aria-hidden={visible?.url === item.url ? undefined : true}
          tabIndex={visible?.url === item.url ? 0 : -1}
          className={visible?.url === item.url ? 'live-preview-active' : 'live-preview-staging'}
          sandbox="allow-scripts allow-same-origin"
          onLoad={(event) => {
            void ready(event.currentTarget, item);
          }}
        />
      ))}
      {!visible && (
        <div className="preview-loading">
          <Icon name="LoaderCircle" className="spin" />
          <p data-ui={'Preparing preview…'}>{t('Preparing preview…')}</p>
        </div>
      )}
      {frameError && (
        <div className="preview-frame-error" role="alert">
          {frameError}
          <button
            className="button secondary small"
            onClick={controller.refresh}
            data-ui={'Refresh preview'}
          >
            {t('Refresh preview')}
          </button>
        </div>
      )}
    </div>
  );
}
