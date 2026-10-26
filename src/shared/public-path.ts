/** A deployment prefix is separate from authored, site-relative routes. */
export function validBasePath(value: string) {
  if (!value) return true;
  try {
    const decoded = decodeURIComponent(value);
    return (
      /^\/(?!\/)/.test(value) &&
      !value.endsWith('/') &&
      !/[\\\s?#]/.test(decoded) &&
      ![...decoded].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
      !/%(?:2f|5c)/i.test(value) &&
      decoded
        .slice(1)
        .split('/')
        .every((part) => part && part !== '.' && part !== '..')
    );
  } catch {
    return false;
  }
}

/** Workers infer the same prefix from their fingerprinted bundle location. */
export function readerBasePath(): string {
  if (typeof document !== 'undefined') {
    const value = document.documentElement?.dataset?.siteBase || '';
    return validBasePath(value) ? value : '';
  }
  if (typeof location !== 'undefined' && typeof location.pathname === 'string') {
    const marker = location.pathname.lastIndexOf('/assets/bundles/');
    const value = location.pathname.slice(0, marker);
    if (marker >= 0 && validBasePath(value)) return value;
  }
  return '';
}

export function publicPath(value: string, base = readerBasePath()) {
  return /^\/(?!\/)/.test(value) ? base + value : value;
}

export function logicalPath(value: string, base = readerBasePath()) {
  return base && value.startsWith(base + '/') ? value.slice(base.length) : value;
}

export function publicAsset(value: string, pattern: RegExp, base = readerBasePath()) {
  return (
    typeof value === 'string' &&
    (!base || value.startsWith(base + '/')) &&
    pattern.test(logicalPath(value, base))
  );
}

export function publicUrl(value: string, origin: string, base = '') {
  return new URL(publicPath(value, base), origin).href;
}
