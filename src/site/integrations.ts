import { t } from '../shared/i18n.js';
import { startDiscussions } from './discussions.js';
import type { SiteConfig } from '../shared/contracts.js';
type AnalyticsWindow = Window & {
  dataLayer?: IArguments[];
  gtag?: (...args: unknown[]) => void;
};
export function startIntegrations() {
  const root = document.documentElement;
  const aca = document.querySelector<HTMLMetaElement>('meta[name=aca-config]');
  if (aca && !root.dataset.preview)
    void import('./aca.js')
      .then(({ startAca }) => startAca(JSON.parse(aca.content)))
      .catch(() => {});
  if (document.querySelector('[data-aca-controls]'))
    void import('./aca-consent.js').then(({ startAnalyticsControls }) => startAnalyticsControls());
  document.querySelectorAll<HTMLButtonElement>('[data-aca-privacy]').forEach((button) => {
    button.disabled = false;
    button.addEventListener('click', () => {
      void import('./aca-consent.js').then((m) => m.openAnalyticsPrivacy(button));
    });
  });
  const showPrivacy = () => {
    if (location.pathname === '/settings/' && location.hash === '#privacy')
      document.querySelector<HTMLButtonElement>('[data-aca-privacy]')?.click();
  };
  showPrivacy();
  addEventListener('hashchange', showPrivacy);
  const analytics = document.querySelector<HTMLElement>('[data-analytics]');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const privacy =
    navigator.doNotTrack === '1' ||
    navigator.doNotTrack === 'yes' ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
  if (analytics && !root.dataset.preview && !local) {
    const config = JSON.parse(
      analytics.dataset.analytics!,
    ) as SiteConfig['integrations']['analytics'];
    const existing = [...document.scripts].some((script) => {
      if (!script.src) return false;
      const url = new URL(script.src);
      return (
        url.origin === 'https://static.cloudflareinsights.com' &&
        (url.pathname === '/beacon.min.js' || url.pathname.startsWith('/beacon.min.js/'))
      );
    });
    if (
      config.enabled &&
      config.mode !== 'managed' &&
      !existing &&
      (!config.respectPrivacy || !privacy)
    ) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      script.dataset.cfBeacon = JSON.stringify({ token: config.token, spa: false });
      document.body.append(script);
    }
  }
  const google = document.querySelector<HTMLElement>('[data-google-analytics]');
  if (google && !root.dataset.preview && !local && google.dataset.started !== 'true') {
    const config = JSON.parse(
      google.dataset.googleAnalytics!,
    ) as SiteConfig['integrations']['googleAnalytics'];
    const globals = window as AnalyticsWindow;
    const optedOut =
      (window as unknown as Record<string, unknown>)[`ga-disable-${config.measurementId}`] === true;
    if (
      config.enabled &&
      /^G-[A-Z0-9]{4,30}$/.test(config.measurementId) &&
      !optedOut &&
      (!config.respectPrivacy || !privacy)
    ) {
      google.dataset.started = 'true';
      const existing = [...document.scripts].some((script) => {
        const url = new URL(script.src || location.href);
        return (
          url.origin === 'https://www.googletagmanager.com' &&
          url.pathname === '/gtag/js' &&
          url.searchParams.get('id') === config.measurementId
        );
      });
      // An existing installation of this stream owns its page view.
      if (!existing) {
        const queue = (globals.dataLayer ||= []);
        const gtag = (globals.gtag ||= function (..._args: unknown[]) {
          // Google's documented queue consumes Arguments objects.
          // eslint-disable-next-line prefer-rest-params
          queue.push(arguments);
        });
        gtag('js', new Date());
        gtag('config', config.measurementId, {
          send_page_view: true,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          ...(config.debugMode ? { debug_mode: true } : {}),
        });
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.measurementId)}`;
        document.head.append(script);
      }
    }
  }
  const conversations = startDiscussions();
  if (conversations && document.querySelector('.article-body[data-entry-id]'))
    void import('./line-discussions.js')
      .then(({ startLineDiscussions }) => startLineDiscussions(conversations))
      .catch(() => {
        const action = document.querySelector<HTMLButtonElement>('[data-discuss-line]');
        if (action) action.title = t('Line discussions could not load. Reload to try again.');
      });
}
