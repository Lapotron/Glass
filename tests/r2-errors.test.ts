import { expect, it } from 'vitest';
import { r2RequestError } from '../src/server/r2-errors.js';

it('distinguishes an absent bucket from missing write permission', () => {
  expect(
    r2RequestError({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }, 'media upload')
      .message,
  ).toMatch(/HTTP 404, NoSuchBucket.*actual public media bucket/);
  expect(
    r2RequestError({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }, 'media upload')
      .message,
  ).toMatch(/HTTP 403, AccessDenied.*Object Read & Write/);
});
it('does not misdiagnose a signature failure as missing Object Write permissions', () => {
  const error = r2RequestError(
    { name: 'SignatureDoesNotMatch', $metadata: { httpStatusCode: 403 } },
    'media upload',
  );
  expect(error.message).toContain('matching R2 S3 access key ID and secret');
  expect(error.message).not.toContain('Object Read & Write');
});
it('never forwards SDK messages, unknown codes or signed request details', () => {
  const marker = 'private-signed-request-and-access-key';
  const error = r2RequestError(
    {
      name: marker,
      code: marker,
      message: marker,
      $response: { headers: { Authorization: marker } },
      $metadata: { httpStatusCode: 403 },
    },
    'object inspection',
  );
  expect(String(error)).not.toContain(marker);
  expect(error.cause).toBeUndefined();
  expect(error.message).toContain('HTTP 403');
});
it('keeps network failures separate and does not claim CI artifacts are retained', () => {
  const error = r2RequestError({ code: 'ETIMEDOUT' }, 'media upload');
  expect(error.message).toContain('network/proxy');
  expect(error.message).toContain('Pages was not uploaded');
  expect(error.message).not.toContain('local build');
});
