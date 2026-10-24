/** SDK errors may contain signed requests. Expose only known codes and HTTP status. */
const codes = new Set([
  'Unauthorized',
  'AccessDenied',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'ExpiredToken',
  'InvalidToken',
  'ExpiredRequest',
  'CredentialsProviderError',
  'NoSuchBucket',
  'InvalidBucketName',
  'NotEntitled',
  'ObjectLockedByBucketPolicy',
  'BadDigest',
  'InvalidDigest',
  'MissingContentLength',
  'IncompleteBody',
  'TooManyRequests',
  'SlowDown',
  'InternalError',
  'ServiceUnavailable',
  'TimeoutError',
  'RequestTimeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
]);
export function r2RequestError(
  error: unknown,
  operation: 'bucket read' | 'object inspection' | 'media upload',
) {
  const detail = (error && typeof error === 'object' ? error : {}) as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const rawStatus = detail.$metadata?.httpStatusCode;
  const status =
    Number.isInteger(rawStatus) && rawStatus! >= 300 && rawStatus! <= 599 ? rawStatus : undefined;
  const code = codes.has(detail.name || '')
    ? detail.name
    : codes.has(detail.code || '')
      ? detail.code
      : undefined;
  const identity = [status ? 'HTTP ' + status : '', code].filter(Boolean).join(', ');
  let hint = 'Check the selected R2 account, public bucket and bucket-scoped S3 credentials.';
  if (code === 'NoSuchBucket' || (status === 404 && operation !== 'object inspection'))
    hint =
      'The configured R2 bucket does not exist in this account. Select the actual public media bucket in Site settings → R2 media delivery.';
  else if (
    [
      'SignatureDoesNotMatch',
      'InvalidAccessKeyId',
      'InvalidToken',
      'ExpiredToken',
      'Unauthorized',
      'CredentialsProviderError',
    ].includes(code || '') ||
    status === 401
  )
    hint =
      'Check the matching R2 S3 access key ID and secret for this account. A Cloudflare API token is not an S3 secret access key.';
  else if (code === 'AccessDenied' || status === 403)
    hint =
      'Check that the R2 S3 token has Object Read & Write permission for the configured public media bucket.';
  else if (
    ['TimeoutError', 'RequestTimeout', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(code || '')
  )
    hint =
      'The R2 connection did not complete. Check network/proxy settings and retry after connectivity is restored.';
  else if (status === 429 || (status && status >= 500))
    hint = 'R2 is temporarily unavailable or rate limiting this request. Wait before retrying.';
  return new Error(
    'R2 ' +
      operation +
      ' failed' +
      (identity ? ' (' + identity + ')' : '') +
      '. ' +
      hint +
      (operation === 'media upload'
        ? ' Existing R2 objects were not removed. Pages was not uploaded.'
        : ''),
  );
}
