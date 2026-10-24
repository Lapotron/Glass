import { t } from '../shared/i18n.js';
import type { AcaSettings } from '../shared/aca.js';
export const acaPreferenceKey = 'fieldnotes-aca-preference';
const identityKey = 'fieldnotes-aca-identity';
export type AcaPreference = 'anonymous' | 'opt-in' | 'off';
export function privacySignal() {
  return (
    ['1', 'yes'].includes(navigator.doNotTrack || '') ||
    Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl)
  );
}
export function analyticsPreference(): AcaPreference {
  try {
    const value = localStorage.getItem(acaPreferenceKey);
    return value === 'off' || value === 'opt-in' ? value : 'anonymous';
  } catch {
    return 'anonymous';
  }
}
export function browserIdentity(create: boolean) {
  try {
    const raw = localStorage.getItem(identityKey),
      stored = raw ? (JSON.parse(raw) as { id: string; expires: number }) : null;
    if (stored && stored.expires > Date.now() && /^[a-f\d-]{36}$/i.test(stored.id))
      return stored.id;
    localStorage.removeItem(identityKey);
    if (create) {
      const id = crypto.randomUUID();
      localStorage.setItem(
        identityKey,
        JSON.stringify({ id, expires: Date.now() + 365 * 86400000 }),
      );
      return id;
    }
  } catch {
    /* Storage unavailable: remain anonymous. */
  }
}
export async function setAnalyticsPreference(
  value: AcaPreference,
  endpoint?: string,
  site?: string,
) {
  const previous = browserIdentity(false);
  // Stop collection immediately, including when a remote forgetting request needs a retry.
  try {
    localStorage.setItem(acaPreferenceKey, value === 'opt-in' ? 'anonymous' : value);
  } catch {
    throw new Error(t('Browser storage is unavailable. Analytics history remains disabled.'));
  }
  dispatchEvent(new Event('fieldnotes:aca-consent'));
  if (previous && value !== 'opt-in') {
    if (endpoint && site) {
      const response = await fetch(`${endpoint.replace(/\/$/, '')}/v1/forget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, visitor: previous }),
        credentials: 'omit',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          t(
            'Collection has stopped. Removing the previous identity from ACA failed; retry this choice when the service is available.',
          ),
        );
    }
    localStorage.removeItem(identityKey);
  }
  localStorage.setItem(acaPreferenceKey, value);
  if (value === 'opt-in' && !privacySignal()) browserIdentity(true);
  dispatchEvent(new Event('fieldnotes:aca-consent'));
}
export function openAnalyticsPrivacy(trigger: HTMLButtonElement) {
  const config = JSON.parse(trigger.dataset.acaPrivacy || '{}') as AcaSettings;
  const dialog = document.createElement('dialog');
  dialog.className = 'reader-privacy-dialog';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h2');
  title.id = 'aca-privacy-title';
  title.textContent = t('Analytics privacy');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.textContent = '×';
  close.setAttribute('aria-label', t('Close'));
  close.addEventListener('click', () => dialog.close());
  head.append(title, close);
  const body = document.createElement('div');
  body.className = 'modal-body';
  const text = document.createElement('p');
  text.textContent = t(
    'ACA measures reading, interactions, approximate network locations and coarse device information. Raw IPs and GPS are not stored.',
  );
  const label = document.createElement('label');
  label.textContent = t('Your choice');
  const select = document.createElement('select');
  for (const [value, key] of [
    ['anonymous', t('Anonymous observations')],
    ...(config.optionalHistory ? [['opt-in', t('Optional cross-day browser history')]] : []),
    ['off', t('Disable ACA')],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(key);
    option.disabled = value === 'opt-in' && privacySignal();
    select.append(option);
  }
  select.value =
    analyticsPreference() === 'opt-in' && !config.optionalHistory
      ? 'anonymous'
      : analyticsPreference();
  label.append(select);
  const help = document.createElement('p');
  help.className = 'help';
  help.textContent = t(
    'Optional history uses a browser identifier for returning-reader reports. Withdrawing removes retained linked observations; anonymous totals remain. A browser privacy signal overrides this choice.',
  );
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'button primary';
  save.textContent = t('Save preference');
  if (privacySignal() && select.value === 'opt-in') select.value = 'anonymous';
  if (privacySignal())
    status.textContent = t('Your browser privacy signal prevents ACA collection.');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await setAnalyticsPreference(select.value as AcaPreference, config.endpoint, config.siteId);
      status.textContent = t('Preference saved. Changes apply to the next page you open.');
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      save.disabled = false;
    }
  });
  body.append(text, label, help, status, save);
  dialog.append(head, body);
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      trigger.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
export function startAnalyticsControls() {
  const section = document.querySelector<HTMLElement>('[data-aca-controls]');
  if (!section) return;
  const select = section.querySelector<HTMLSelectElement>('select')!,
    status = section.querySelector<HTMLElement>('[role=status]')!;
  select.value = analyticsPreference();
  const gate = () => {
    if (privacySignal())
      status.textContent = t(
        'Your browser’s privacy signal prevents all ACA collection, including opt-in identity.',
      );
  };
  gate();
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await setAnalyticsPreference(
        select.value as AcaPreference,
        section.dataset.acaEndpoint,
        section.dataset.acaSite,
      );
      status.textContent = t(
        'Preference saved. Changes apply to the next page you open. Retained identity is removed when you withdraw opt-in; anonymous summaries remain.',
      );
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      select.disabled = false;
      gate();
    }
  });
}
