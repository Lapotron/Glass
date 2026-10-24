import { audienceClient } from './audience-client.js';
import type { AcaBatch, AcaEvent, AcaSettings } from '../shared/aca.js';
import { acaPreferenceKey, analyticsPreference, browserIdentity, privacySignal } from './aca-consent.js';
const safeKey = (value: string) => value.replace(/[^\p{L}\p{N}_./:#%+ -]/gu, '').slice(0, 240);
export function startAca(config: AcaSettings) {
  if (
    !config.enabled ||
    document.documentElement.dataset.preview ||
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ||
    privacySignal() ||
    analyticsPreference() === 'off'
  )
    return;
  const descriptor = document.querySelector<HTMLMetaElement>('meta[name=aca-content]');
  if (!descriptor || document.body.dataset.page === 'settings') return;
  const content = JSON.parse(descriptor.content) as { id: string; revision: string };
  const visitor = config.optionalHistory && analyticsPreference() === 'opt-in' ? browserIdentity(true) : undefined;
  const view = crypto.randomUUID(),
    buckets = Array<number>(20).fill(0),
    sections: Record<string, number> = {};
  let active = 0,
    depth = 0,
    sequence = 0,
    end = false,
    stopped = false,
    last = performance.now(),
    lastInteraction = last,
    events: AcaEvent[] = [],
    pending = false,
    ended = false;
  const article = document.querySelector<HTMLElement>('.article-body'),
    endpoint = config.endpoint.replace(/\/$/, '') + '/v1/events';
  const campaign = (new URLSearchParams(location.search).get('utm_campaign') || '')
    .replace(/[^\w .-]/g, '')
    .slice(0, 100);
  let source = 'direct';
  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;
    source = referrer
      ? referrer.origin === location.origin
        ? 'internal'
        : referrer.hostname.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 150)
      : 'direct';
    const utm = new URLSearchParams(location.search).get('utm_source');
    if (utm && /^[\w.-]{1,70}$/.test(utm)) source = `campaign:${utm}`;
  } catch {
    /* No referrer. */
  }
  const push = (action: AcaEvent['action'], target = '', surface = '', rank = 0, value = 0) => {
    if (
      events.length < 30 &&
      !stopped &&
      (config.collectInteractions || action === 'vital' || action === 'error')
    )
      events.push({
        id: crypto.randomUUID(),
        action,
        target: safeKey(target),
        surface: surface.replace(/[^a-z-]/g, '').slice(0, 40),
        rank: Math.min(10000, Math.max(0, rank)),
        value: Math.max(0, Math.min(3600000, value)),
      });
  };
  const tick = () => {
    const now = performance.now(),
      delta = Math.min(5000, Math.max(0, now - last));
    last = now;
    if (stopped || document.hidden || now - lastInteraction > 60000) return;
    active = Math.round(active + delta);
    if (article) {
      const rect = article.getBoundingClientRect(),
        position = Math.max(0, Math.min(0.9999, (innerHeight * 0.5 - rect.top) / rect.height));
      if (rect.top < innerHeight && rect.bottom > 0) {
        buckets[Math.floor(position * 20)] += Math.round(delta);
        const headings = [...article.querySelectorAll<HTMLElement>('h2[id],h3[id]')];
        const heading = headings
          .filter((node) => node.getBoundingClientRect().top <= innerHeight * 0.55)
          .at(-1);
        if (heading && /^[\p{L}\p{N}_-]{1,100}$/u.test(heading.id))
          sections[heading.id] = (sections[heading.id] || 0) + Math.round(delta);
      }
      depth = Math.max(
        depth,
        Math.min(100, Math.max(0, ((innerHeight - rect.top) / rect.height) * 100)),
      );
      end ||= rect.bottom <= innerHeight && rect.bottom >= 0;
    }
  };
  async function flush(keepalive = false) {
    if (stopped || (pending && !keepalive)) return;
    tick();
    const sent = events.slice(),
      ids = new Set(sent.map((e) => e.id));
    const payload: AcaBatch = {
      version: 2,
      ...(config.collectAudience ? {audience:audienceClient()} : {}),
      site: config.siteId,
      view,
      content: safeKey(content.id),
      revision: content.revision,
      route: location.pathname,
      sequence: ++sequence,
      active,
      depth,
      buckets,
      sections,
      end,
      ended,
      consent: visitor ? 'opt-in' : 'anonymous',
      ...(visitor ? {visitor} : {}),
      networkEstimate: config.dailyNetworkEstimates,
      source,
      campaign,
      device: innerWidth < 600 ? 'phone' : innerWidth < 1000 ? 'tablet' : 'desktop',
      language: navigator.language.split('-')[0].match(/^[a-z]{2,3}$/)?.[0] || 'en',
      events: sent,
    };
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).byteLength > 32000) return;
    pending = true;
    try {
      // sendBeacon always uses credentials: include. Anonymous cross-origin
      // collection must omit cookies even when the document is leaving.
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive,
      });
      if (response.ok) events = events.filter((e) => !ids.has(e.id));
      else if ([403, 429, 503].includes(response.status)) stopped = true;
    } catch {
      /* The next cumulative batch includes unacknowledged events with their original IDs. */
    } finally {
      pending = false;
    }
  }
  const activity = () => {
    lastInteraction = performance.now();
  };
  for (const name of ['pointerdown', 'keydown', 'scroll', 'touchstart'])
    addEventListener(name, activity, { passive: true });
  const interval = setInterval(() => {
      tick();
    }, 1000),
    network = setInterval(() => {
      void flush();
    }, 20000);
  const visibility = () => {
    tick();
    if (document.hidden) void flush(true);
    else {
      last = performance.now();
      lastInteraction = last;
    }
  };
  document.addEventListener('visibilitychange', visibility);
  addEventListener('pagehide', () => {
    ended = true;
    void flush(true);
  });
  const stop = () => {
    stopped = true;
    clearInterval(interval);
    clearInterval(network);
    observer.disconnect();
    timers.forEach(clearTimeout);
  };
  addEventListener('fieldnotes:aca-consent', stop);
  addEventListener('storage', event=>{if(event.key===acaPreferenceKey||event.key==='fieldnotes-aca-identity')stop();});
  const seen = new Set<string>(),
    visible = new Set<Element>(),
    timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const item of entries) {
        const node = item.target as HTMLElement;
        if (
          item.intersectionRatio >= 0.5 &&
          !document.hidden &&
          !seen.has(`${node.dataset.acaItem}|${node.dataset.acaSurface}`)
        ) {
          visible.add(node);
          if (!timers.has(node))
            timers.set(
              node,
              setTimeout(() => {
                timers.delete(node);
                if (visible.has(node) && !document.hidden) {
                  seen.add(`${node.dataset.acaItem}|${node.dataset.acaSurface}`);
                  push(
                    'impression',
                    node.dataset.acaItem,
                    node.dataset.acaSurface,
                    Number(node.dataset.acaRank || 0),
                  );
                }
              }, 1000),
            );
        } else {
          visible.delete(node);
          clearTimeout(timers.get(node));
          timers.delete(node);
        }
      }
    },
    { threshold: [0.5] },
  );
  const observed = new Set<HTMLElement>();
  const scan = () => {
    if (stopped) return;
    for (const node of observed)
      if (!node.isConnected) {
        observed.delete(node);
        visible.delete(node);
        clearTimeout(timers.get(node));
        timers.delete(node);
        observer.unobserve(node);
      }
    document.querySelectorAll<HTMLElement>('[data-aca-item]').forEach((node) => {
      if (!observed.has(node)) {
        observed.add(node);
        observer.observe(node);
      }
    });
  };
  scan();
  addEventListener('fieldnotes:search-results', scan);
  addEventListener('fieldnotes:archive-updated', scan);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      timers.forEach(clearTimeout);
      timers.clear();
      visible.clear();
    } else scan();
  });
  document.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-tools-page],[data-tools-download]')) return;
    const node = (event.target as Element).closest<HTMLElement>('a,button,[data-interactive]');
    if (!node) return;
    const card = node.closest<HTMLElement>('[data-aca-item]');
    if (card)
      push(
        'click',
        card.dataset.acaItem,
        card.dataset.acaSurface,
        Number(card.dataset.acaRank || 0),
      );
    if (node instanceof HTMLAnchorElement) {
      try {
        const url = new URL(node.href);
        if (url.origin !== location.origin && /^https?:$/.test(url.protocol))
          push('outbound', url.hostname);
        if (node.download || /^\/media\//.test(url.pathname))
          push('download', url.pathname.split('/').at(-1));
      } catch {
        /* Ignore non-URL controls. */
      }
    }
    if (node.matches('[data-share-action],.article-share-button,[data-share-native]'))
      push('share', 'article');
    if (node.matches('.copy-code,[data-copy-citation],[data-copy-shortlink]'))
      push('copy', node.classList.contains('copy-code') ? 'code' : 'article');
    if (node.closest('[data-image-viewer],.photo-card')) push('media', 'image-open');
    if (node.closest('[data-interactive]'))
      push(
        'widget',
        node.closest<HTMLElement>('[data-interactive]')?.dataset.interactive?.slice(0, 40) ||
          'component',
      );
  });
  addEventListener('fieldnotes:analytics', ((
    event: CustomEvent<{ action: 'search'; count: number }>,
  ) => push('search', 'results', 'search', 0, event.detail.count)) as EventListener);
  if (config.collectVitals)
    void import('web-vitals').then(({ onCLS, onINP, onLCP }) => {
      const receive = (metric: { name: string; value: number }) =>
        push('vital', metric.name, '', 0, metric.value * (metric.name === 'CLS' ? 1000 : 1));
      onCLS(receive);
      onINP(receive);
      onLCP(receive);
    });
  addEventListener('error', () => push('error', 'runtime'));
  addEventListener('unhandledrejection', () => push('error', 'promise'));
  void flush();
}
