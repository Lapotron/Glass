import type { AudienceClient, AudienceMetadata } from '../shared/audience.js';
const label = (value: unknown, length = 100) =>
  typeof value === 'string' ? value.replace(/[<>\p{Cc}]/gu, '').slice(0, length) : '';
const coordinate = (value: unknown, limit: number) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 100) / 100 : null;
};
/** request.cf is supplied by the edge. Payloads/forwarded headers never supply geography. */
export function audienceMetadata(request: Request, client?: AudienceClient): AudienceMetadata {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf || {};
  const ua = (request.headers.get('User-Agent') || '').slice(0, 1000);
  const match = (pattern: RegExp) => ua.match(pattern)?.[1] || '';
  const browser = /Edg\//.test(ua)
    ? 'Edge ' + match(/Edg\/(\d+)/)
    : /(?:OPR|Opera)\//.test(ua)
      ? 'Opera ' + match(/(?:OPR|Opera)\/(\d+)/)
      : /(?:Firefox|FxiOS)\//.test(ua)
        ? 'Firefox ' + match(/(?:Firefox|FxiOS)\/(\d+)/)
        : /(?:Chrome|CriOS)\//.test(ua)
          ? 'Chrome ' + match(/(?:Chrome|CriOS)\/(\d+)/)
          : /Safari\//.test(ua)
            ? 'Safari ' + match(/Version\/(\d+)/)
            : 'Unknown';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android ' + match(/Android (\d+)/)
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS ' + match(/OS (\d+)/)
        : /Macintosh|Mac OS X/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown';
  const device = /iPad|Tablet|Android(?!.*Mobile)/.test(ua)
    ? 'tablet'
    : /Mobile|iPhone|iPod/.test(ua)
      ? 'phone'
      : /Windows|Macintosh|Linux|CrOS/.test(ua)
        ? 'desktop'
        : 'Unknown';
  return {
    ...client,
    country: /^[A-Z]{2}$/.test(String(cf.country)) ? String(cf.country) : 'Unknown',
    continent: label(cf.continent, 2),
    region: label(cf.region),
    city: label(cf.city),
    timezone: label(cf.timezone),
    latitude: coordinate(cf.latitude, 90),
    longitude: coordinate(cf.longitude, 180),
    asn: Number.isSafeInteger(cf.asn) ? String(cf.asn) : '',
    network: label(cf.asOrganization),
    edge: label(cf.colo, 8),
    protocol: label(cf.httpProtocol, 20),
    tls: label(cf.tlsVersion, 20),
    browser: browser.trim(),
    os: os.trim(),
    device,
    engine: /AppleWebKit/.test(ua)
      ? /Chrome|Edg\//.test(ua) && !/CriOS/.test(ua)
        ? 'Blink'
        : 'WebKit'
      : /Gecko\//.test(ua)
        ? 'Gecko'
        : 'Unknown',
  };
}
