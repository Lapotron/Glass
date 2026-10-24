import type { Store } from '../engine/store.js';
import type { ConnectionSettings } from './configuration.js';
import { acaReports, type AcaReportName, type AcaReport } from '../shared/aca.js';
import { reportRange } from '../aca/reports.js';
import { acaServiceFetch } from './aca-fetch.js';
export async function analyticsStatus(
  store: Store,
  connections: ConnectionSettings,
  fetcher: typeof fetch = acaServiceFetch,
) {
  const config = (await store.snapshot()).site.integrations.aca;
  if (!config.endpoint || !config.siteId)
    throw new Error('Configure the ACA Worker origin and site ID first.');
  const token = (await connections.values()).ACA_REPORT_TOKEN;
  if (!token) throw new Error('Save the private ACA report token in Connections.');
  const response = await fetcher(new URL('/v1/status', config.endpoint), {
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      'ACA readiness check failed (' +
        response.status +
        '). Check service credentials and migrations.',
    );
  const status = (await response.json()) as {
    protocol: number;
    enabled: boolean;
    paused: boolean;
    networkMode: string;
    pendingDays: number;
    capabilities?: string[];
  };
  if (
    ![2, 3].includes(status.protocol) ||
    typeof status.enabled !== 'boolean' ||
    !Number.isSafeInteger(status.pendingDays)
  )
    throw new Error('ACA and Studio use different service protocols. Update the service first.');
  return status;
}
export async function proxyAnalytics(
  store: Store,
  connections: ConnectionSettings,
  name: string,
  query: URLSearchParams,
  fetcher: typeof fetch = acaServiceFetch,
) {
  const optionsOnly = name === 'segment-options';
  if (!optionsOnly && !acaReports.includes(name as AcaReportName))
    throw new Error('Choose a named ACA report.');
  const { site } = await store.snapshot(),
    config = site.integrations.aca;
  if (!config.endpoint || !config.siteId)
    throw new Error('Set the ACA Worker origin and site ID in Site settings → Integrations.');
  const credentials = await connections.values(),
    token = credentials.ACA_REPORT_TOKEN;
  if (!token)
    throw new Error(
      'Save the ACA report token in Site settings → Connections. It stays private to Studio.',
    );
  const url = new URL(optionsOnly ? '/v1/segment-options' : `/v1/reports/${name}`, config.endpoint);
  for (const key of ['from', 'to', 'content', 'revision', 'cursor', 'segment'])
    if (query.has(key)) url.searchParams.set(key, query.get(key)!);
  reportRange(url);
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (optionsOnly && response.status === 404)
      throw new Error('Deploy the updated ACA Worker to enable audience segments.');
    throw new Error(
      response.status === 401
        ? 'ACA rejected the report token. Check its Worker secret and your saved connection.'
        : `ACA could not load this report (${response.status}). Check the Worker and D1 migrations.`,
    );
  }
  const text = await response.text();
  if (text.length > 4 * 1024 * 1024)
    throw new Error('ACA report is too large. Narrow the date range.');
  const result = JSON.parse(text) as AcaReport;
  if (optionsOnly) {
    const value = JSON.parse(text) as import('../shared/aca-segments.js').SegmentOptions;
    if (!value.options || !value.coverage || !Array.isArray(value.coverage.missingDays))
      throw new Error('Update ACA to enable audience segments.');
    return value;
  }
  if (url.searchParams.has('segment') && !result.segment)
    throw new Error('Deploy the updated ACA Worker to enable audience segments.');
  if (
    result.name !== name ||
    !Array.isArray(result.metrics) ||
    !Array.isArray(result.series) ||
    !Array.isArray(result.rows)
  )
    throw new Error('ACA returned an incompatible report. Update the service and Studio together.');
  return result;
}
