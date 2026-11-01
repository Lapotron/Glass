/** A destination is private configuration, not arbitrary reader input. Redirects remain forbidden. */
export function validAlertWebhook(value: string) {
  try {
    const url = new URL(value);
    return (
      value.length <= 4096 &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      !/^\[/.test(url.hostname) &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      url.hostname.includes('.') &&
      !/(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}
