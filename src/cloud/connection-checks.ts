import { AwsClient } from 'aws4fetch';
import type { SiteConfig } from '../shared/contracts.js';
import type { CloudflareConnection } from '../shared/local-settings.js';
import { r2Readiness } from '../server/r2-readiness.js';
import { PagesConnection } from './pages.js';
import { CloudError } from './types.js';
import { r2RequestError } from '../server/r2-errors.js';

/** These checks run on the authenticated Studio Worker, independently of its build queue. */
export async function checkR2Connection(
  site: SiteConfig,
  credentials: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
) {
  const readiness = r2Readiness(site, credentials);
  if (!readiness.configured)
    throw new Error(
      'R2 needs: ' +
        readiness.missing.join(', ') +
        '. Set the account in Site settings → Publishing and the bucket/domain in R2 media delivery; save S3 credentials in Credentials.',
    );
  const client = new AwsClient({
    accessKeyId: credentials.R2_ACCESS_KEY_ID!,
    secretAccessKey: credentials.R2_SECRET_ACCESS_KEY!,
    region: 'auto',
    service: 's3',
  });
  const request = await client.sign(
    'https://' +
      site.cloudflare.accountId +
      '.r2.cloudflarestorage.com/' +
      encodeURIComponent(site.mediaDelivery.bucket) +
      '?list-type=2&max-keys=1',
    { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000) },
  );
  let response: Response;
  try {
    response = await fetcher(request);
  } catch {
    throw new Error(
      'Could not read the R2 bucket. Check the account, bucket and saved S3 credentials, then retry. The check times out after 15 seconds and does not use Workers Builds.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      'Could not read the R2 bucket. ' +
        r2RequestError({ $metadata: { httpStatusCode: response.status } }, 'bucket read').message,
    );
  }
  try {
    // The one-object listing verifies the saved S3 pair, not the private BUCKET binding.
    // Never return object names, signed headers or upstream error bodies to the browser.
    if (!/<ListBucketResult(?:\s|>)/.test(await response.text()))
      throw new Error('R2 returned an unreadable listing.');
  } catch {
    throw new Error(
      'Could not read the R2 bucket. Check the account, bucket and saved S3 credentials, then retry. The check times out after 15 seconds and does not use Workers Builds.',
    );
  }
  return {
    ok: true,
    message:
      'Bucket read access verified. Upload permission and CDN delivery are checked during publication.',
  };
}

/** Preserve the Pages connection response for API clients without invoking local Wrangler. */
export async function checkCloudflareConnection(
  accountId: string,
  credentials: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
): Promise<CloudflareConnection> {
  const token = credentials.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('Save a Cloudflare API token in Credentials first.');
  const read = async (path: string) => {
    const response = await fetcher('https://api.cloudflare.com/client/v4' + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('Cloudflare returned a redirect.');
    }
    const data = (await response.json()) as { success?: boolean; result?: unknown };
    if (!response.ok || !data.success || !Array.isArray(data.result))
      throw new Error(
        response.status === 401 || response.status === 403 ? 'denied' : 'unavailable',
      );
    if (
      path.includes('/pages/projects') &&
      data.result.some(
        (project) => !project || typeof project.name !== 'string' || !project.name.trim(),
      )
    )
      throw new Error('unavailable');
    return data.result;
  };
  const [accounts, pages] = await Promise.allSettled([
    read('/accounts?per_page=50'),
    accountId ? new PagesConnection(accountId, token, fetcher).list() : Promise.resolve([]),
  ]);
  const verified = Boolean(accountId && pages.status === 'fulfilled');
  return {
    authenticated: accounts.status === 'fulfilled' || verified,
    accountId,
    accounts:
      accounts.status === 'fulfilled'
        ? accounts.value.flatMap((account) =>
            account && typeof account.id === 'string' && typeof account.name === 'string'
              ? [{ id: account.id, name: account.name }]
              : [],
          )
        : [],
    projects:
      verified && pages.status === 'fulfilled'
        ? pages.value.flatMap((project) =>
            project && typeof project.name === 'string' ? [{ name: project.name }] : [],
          )
        : [],
    pagesAccess: !accountId
      ? 'unchecked'
      : verified
        ? 'verified'
        : pages.status === 'rejected' &&
            pages.reason instanceof CloudError &&
            pages.reason.status === 403
          ? 'denied'
          : 'unavailable',
    ...(!accountId
      ? { error: 'Set the Cloudflare account ID in Site settings → Publishing first.' }
      : !verified
        ? {
            error:
              pages.status === 'rejected' && pages.reason instanceof CloudError
                ? pages.reason.message
                : 'Could not reach Cloudflare Pages. Check the connection and retry. No build was queued.',
          }
        : {}),
  };
}
