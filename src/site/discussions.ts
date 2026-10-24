import { t, setUiText, type UiParams } from '../shared/i18n.js';
import { builtInDiscussionTheme, type DiscussionConfig } from '../shared/discussions.js';
import type { GiscusWidget } from 'giscus';
import { annotationLink as annotationURL } from '../shared/annotations.js';

const widgets = new Set<GiscusWidget>();
const discussionCountLabels = [
  ['{count} comment', '{count} comments'],
  ['{count} reply', '{count} replies'],
  ['{count} reaction', '{count} reactions'],
] as const;
let provider: Promise<unknown> | undefined;
function loadProvider() {
  return (provider ??= import('giscus')
    .then(({ GiscusWidget }) => {
      // giscus 1.6.0 listens on window but does not scope resize/error messages by iframe.
      // Keep its OAuth/session handling while guarding the pinned component's message entrypoint.
      const prototype = GiscusWidget.prototype as unknown as {
        handleMessageEvent(this: GiscusWidget, event: MessageEvent): void;
      };
      const handle = prototype.handleMessageEvent;
      if (typeof handle !== 'function') throw new Error(t('Unsupported Giscus component version.'));
      prototype.handleMessageEvent = function (event) {
        const own = event.source === this.iframeRef?.contentWindow;
        const sharedSignOut =
          event.data?.giscus?.signOut &&
          [...widgets].some((widget) => event.source === widget.iframeRef?.contentWindow);
        if (event.origin === 'https://giscus.app' && (own || sharedSignOut))
          handle.call(this, event);
      };
    })
    .catch((error) => {
      provider = undefined;
      throw error;
    }));
}
const themes = new Map<string, Promise<string>>();
export type Conversation = { load: () => void; destroy: () => void };
export type ConversationService = {
  config: DiscussionConfig;
  mount: (host: HTMLElement) => Conversation;
};
async function themeFor(config: DiscussionConfig, prefix: string) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const fallback = builtInDiscussionTheme(config, dark);
  if (
    config.theme !== 'site' ||
    location.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  )
    return fallback;
  prefix =
    document.querySelector<HTMLMetaElement>('meta[name="discussion-theme-prefix"]')?.content ||
    prefix;
  const url = new URL(`${prefix}${dark ? 'dark' : 'light'}.css`, location.origin);
  if (url.origin !== location.origin) return fallback;
  if (!themes.has(url.href))
    themes.set(
      url.href,
      fetch(url, { signal: AbortSignal.timeout(4000) })
        .then((response) => {
          const cors = response.headers.get('Access-Control-Allow-Origin');
          if (
            response.ok &&
            response.headers.get('Content-Type')?.includes('text/css') &&
            (cors === '*' || cors === 'https://giscus.app')
          )
            return url.href;
          throw new Error(t('Custom discussion theme is unavailable.'));
        })
        .catch(() => {
          themes.delete(url.href);
          return fallback;
        }),
    );
  return themes.get(url.href)!;
}

export function startDiscussions(): ConversationService | undefined {
  const root = document.documentElement;
  if (root.dataset.preview) return;
  const configHost = document.querySelector<HTMLElement>('[data-comments]');
  if (!configHost) return;
  const config = JSON.parse(configHost.dataset.comments!) as DiscussionConfig;
  if (!config.enabled) return;
  const dispose = new Set<() => void>();
  const hosts = [configHost, ...document.querySelectorAll<HTMLElement>('[data-section-thread]')];
  let sequence = 0;
  const mount = (host: HTMLElement): Conversation => {
    const index = sequence++;
    const section = host.hasAttribute('data-section-thread');
    const noun = host.hasAttribute('data-line-thread') ? 'annotation' : 'discussion';
    const inline = section || host.hasAttribute('data-line-thread');
    const anchor = host.dataset.commentAnchor || host.id;
    const container = host.querySelector<HTMLElement>(
      section ? '[data-section-thread-host]' : '.giscus',
    )!;
    const button = host.querySelector<HTMLButtonElement>('[data-load-comments]');
    const status = host.querySelector<HTMLElement>('[data-comments-status]')!;
    const metadata = host.querySelector<HTMLElement>('[data-discussion-meta]')!;
    const link = host.querySelector<HTMLAnchorElement>('[data-comment-link]')!;
    const actions = host.querySelector<HTMLElement>('.discussion-actions')!;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button ghost small';
    retry.hidden = true;
    retry.dataset.retryDiscussion = '';
    setUiText(retry, noun === 'annotation' ? 'Reload annotation' : 'Reload discussion');
    actions.append(retry);
    link.href = `https://github.com/${config.repo}/discussions`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    let widget: GiscusWidget | undefined;
    let generation = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let observer: IntersectionObserver | undefined;
    let active = false;
    const setState = (state: string, message: string, params?: UiParams) => {
      host.dataset.discussionState = state;
      host.setAttribute('aria-busy', String(state === 'loading'));
      setUiText(status, message, params);
      if (button) {
        button.disabled = state === 'loading';
        button.hidden = ['ready', 'empty', 'locked'].includes(state);
      }
      retry.hidden = state === 'idle' || state === 'loading';
      setUiText(
        retry,
        state === 'unavailable'
          ? noun === 'annotation'
            ? 'Retry annotation'
            : 'Retry discussion'
          : noun === 'annotation'
            ? 'Reload annotation'
            : 'Reload discussion',
      );
      if (state !== 'loading') clearTimeout(timeout);
    };
    const counts = (comments: number, replies: number, reactions: number) => {
      const count = (value: number) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
      delete metadata.dataset.ui;
      delete metadata.dataset.uiParams;
      metadata.replaceChildren();
      for (const [index, [single, plural]] of discussionCountLabels.entries()) {
        const value = count([comments, replies, reactions][index]);
        if (metadata.childNodes.length) metadata.append(' · ');
        const part = document.createElement('span');
        setUiText(part, value === 1 ? single : plural, { count: value });
        metadata.append(part);
      }
      metadata.hidden = !config.showMetadata;
      if (!inline && config.showMetadata) {
        const jump = document.querySelector<HTMLElement>('[data-discussion-jump-label]');
        if (jump)
          setUiText(
            jump,
            count(comments) + count(replies) === 1
              ? '{count} comment · Join the discussion'
              : '{count} comments · Join the discussion',
            { count: count(comments) + count(replies) },
          );
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'https://giscus.app' ||
        event.source !== widget?.iframeRef?.contentWindow ||
        !widget?.isConnected
      )
        return;
      const data = event.data?.giscus;
      if (!data || typeof data !== 'object') return;
      if (typeof data.error === 'string') {
        if (data.error.includes('Discussion not found')) {
          timedOut = false;
          counts(0, 0, 0);
          setState('empty', 'Be the first to leave a note. Sign in with GitHub to join.');
        } else if (/Bad credentials|Invalid state|expired/i.test(data.error)) {
          setState(
            'ready',
            'Your GitHub session expired. Sign in again in the conversation below.',
          );
        } else
          setState(
            'unavailable',
            'Discussion unavailable. {error} Try again or open it on GitHub.',
            { error: data.error.slice(0, 240) },
          );
        return;
      }
      if (data.discussion && typeof data.discussion === 'object') {
        timedOut = false;
        const discussion = data.discussion;
        if (
          discussion.repository?.nameWithOwner &&
          discussion.repository.nameWithOwner.toLowerCase() !== config.repo.toLowerCase()
        )
          return;
        counts(discussion.totalCommentCount, discussion.totalReplyCount, discussion.reactionCount);
        try {
          const url = new URL(discussion.url);
          const base = `/${config.repo}/discussions/`.toLowerCase();
          if (
            url.origin === 'https://github.com' &&
            url.pathname.toLowerCase().startsWith(base) &&
            /^\d+$/.test(url.pathname.slice(base.length))
          )
            link.href = url.href;
        } catch {
          /* Keep the repository fallback until a valid discussion URL is available. */
        }
        setState(
          discussion.locked ? 'locked' : 'ready',
          discussion.locked
            ? 'This conversation is locked. You can still read it here or on GitHub.'
            : 'Sign in with GitHub to join the conversation.',
        );
        if (host.hasAttribute('data-line-thread') && annotationURL(link.href, config.repo))
          host.dispatchEvent(
            new CustomEvent('fieldnotes:annotation', {
              bubbles: true,
              detail: {
                fragment: anchor,
                quote: host.dataset.commentQuote || '',
                url: link.href,
                updatedAt: new Date().toISOString(),
                comments:
                  Number.isSafeInteger(discussion.totalCommentCount) &&
                  discussion.totalCommentCount >= 0
                    ? discussion.totalCommentCount
                    : undefined,
                // The widget initially combines front/back pages of 15 comments each.
                // Longer conversations may report only the loaded pages' replies.
                replies:
                  Number.isSafeInteger(discussion.totalCommentCount) &&
                  discussion.totalCommentCount <= 30 &&
                  Number.isSafeInteger(discussion.totalReplyCount) &&
                  discussion.totalReplyCount >= 0
                    ? discussion.totalReplyCount
                    : undefined,
              },
            }),
          );
      } else if (
        typeof data.resizeHeight === 'number' &&
        (host.dataset.discussionState === 'loading' || timedOut)
      ) {
        timedOut = false;
        setState('ready', 'Sign in with GitHub to join the conversation.');
      }
    };
    window.addEventListener('message', onMessage);
    const load = async (force = false) => {
      if (active && !force) return;
      active = true;
      timedOut = false;
      observer?.disconnect();
      const current = ++generation;
      if (widget) {
        widgets.delete(widget);
        widget.remove();
        widget = undefined;
      }
      metadata.hidden = true;
      setState('loading', noun === 'annotation' ? 'Loading annotation…' : 'Loading discussion…');
      timeout = setTimeout(() => {
        if (current !== generation) return;
        timedOut = true;
        setState(
          'unavailable',
          'The conversation is taking longer than expected. Retry or open it on GitHub.',
        );
      }, 15000);
      try {
        const [, theme] = await Promise.all([
          loadProvider(),
          themeFor(config, configHost.dataset.commentTheme!),
        ]);
        if (current !== generation) return;
        // The SDK consumes an OAuth callback and clears the hash in its constructor.
        // Retain the selected quote without restoring the consumed session query.
        const lineHash = location.hash;
        widget = document.createElement('giscus-widget');
        if (lineHash.startsWith('#line-') && !location.hash)
          history.replaceState(
            history.state,
            '',
            `${location.pathname}${location.search}${lineHash}`,
          );
        widget.id = host.dataset.commentAnchor || `giscus-conversation-${index}`;
        const language =
          config.language === 'auto' ? document.documentElement.lang || 'en' : config.language;
        const attributes = {
          repo: config.repo,
          repoid: config.repoId,
          category: config.category,
          categoryid: config.categoryId,
          mapping: host.dataset.commentNumber ? 'number' : 'specific',
          term: host.dataset.commentNumber || host.dataset.commentTerm!,
          strict: '1',
          reactionsenabled: config.reactions ? '1' : '0',
          emitmetadata: '1',
          inputposition: config.inputPosition,
          theme,
          lang:
            language === 'zh' || language === 'zh-Hans'
              ? 'zh-CN'
              : language === 'zh-Hant'
                ? 'zh-TW'
                : language,
          loading: 'eager',
        };
        for (const [key, value] of Object.entries(attributes)) widget.setAttribute(key, value);
        if (host.dataset.commentQuote) {
          // The pinned SDK exposes these supported iframe parameters through page metadata only.
          // Supply per-instance context so simultaneous article/line threads cannot share a quote.
          const component = widget as unknown as { getIframeSrc(): string };
          if (typeof component.getIframeSrc !== 'function')
            throw new Error(t('Unsupported Giscus component version.'));
          const source = component.getIframeSrc.bind(component);
          const backLink = new URL(location.pathname, location.origin);
          backLink.hash = anchor;
          const quote = host.dataset.commentQuote;
          component.getIframeSrc = () => {
            const url = new URL(source());
            url.searchParams.set('description', `> ${quote.replace(/\n/g, '\n> ')}`);
            url.searchParams.set('backLink', backLink.href);
            return url.href;
          };
        }
        widgets.add(widget);
        container.replaceChildren(widget);
      } catch {
        if (current === generation) {
          active = false;
          setState('unavailable', 'Discussion could not load. Try again or open it on GitHub.');
        }
      }
    };
    const trigger = () => {
      void load(host.dataset.discussionState === 'unavailable');
    };
    const reload = () => {
      clearTimeout(timeout);
      void load(true);
    };
    retry.addEventListener('click', reload);
    button?.addEventListener('click', trigger);
    const toggle = () => {
      if ((host as HTMLDetailsElement).open) trigger();
    };
    if (section) host.addEventListener('toggle', toggle);
    else if (!inline && !config.onDemand) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) trigger();
        },
        { rootMargin: '200px' },
      );
      observer.observe(host);
    }
    const fromHash = () => {
      if (location.hash !== `#${anchor}`) return;
      if (section) (host as HTMLDetailsElement).open = true;
      trigger();
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
    const copyButton = host.querySelector<HTMLButtonElement>('[data-copy-discussion]');
    const copy = async () => {
      const url = new URL(location.pathname, location.origin);
      url.hash = anchor;
      try {
        await navigator.clipboard.writeText(url.href);
        setUiText(status, 'Conversation link copied.');
      } catch {
        setUiText(status, 'Conversation link: {value0}', { value0: url.href });
      }
    };
    copyButton?.addEventListener('click', copy);
    const themeObserver = new MutationObserver(() => {
      const current = generation;
      void themeFor(config, configHost.dataset.commentTheme!).then((theme) => {
        if (current === generation) widget?.setAttribute('theme', theme);
      });
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const updateLanguage = () => {
      if (config.language !== 'auto') return;
      const language = document.documentElement.lang;
      widget?.setAttribute(
        'lang',
        language === 'zh-Hans' ? 'zh-CN' : language === 'zh-Hant' ? 'zh-TW' : language || 'en',
      );
    };
    addEventListener('glass:language', updateLanguage);
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      dispose.delete(destroy);
      generation++;
      clearTimeout(timeout);
      observer?.disconnect();
      themeObserver.disconnect();
      removeEventListener('glass:language', updateLanguage);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('hashchange', fromHash);
      host.removeEventListener('toggle', toggle);
      button?.removeEventListener('click', trigger);
      retry.removeEventListener('click', reload);
      retry.remove();
      copyButton?.removeEventListener('click', copy);
      if (widget) {
        widgets.delete(widget);
        widget.remove();
      }
    };
    dispose.add(destroy);
    return { load: trigger, destroy };
  };
  hosts.forEach(mount);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) dispose.forEach((cleanup) => cleanup());
  });
  return { mount, config };
}
