/** Real browser archive export/verification. Synthetic data only; never reads a notebook or cloud credentials. */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const size = Number(process.env.GLASS_BACKUP_BENCH_BYTES || 2 * 1024 ** 3 + 17);
if (!Number.isSafeInteger(size) || size < 1 || size > 4 * 1024 ** 3)
  throw new Error('Choose 1 byte through 4 GiB.');
const run = promisify(execFile),
  block = randomBytes(1024 ** 2),
  expected = createHash('sha256');
for (let offset = 0; offset < size; offset += block.length)
  expected.update(block.subarray(0, Math.min(block.length, size - offset)));
const sha = expected.digest('hex'),
  id = randomUUID(),
  session = Date.now() + '-' + randomUUID();
const settings = new Map<string, Buffer>();
for (const name of ['site.json', 'library.json'])
  settings.set('content/' + name, await fs.readFile('tests/fixtures/notebook/' + name));
const files = [...settings]
  .map(([path, value]) => ({
    path,
    bytes: value.length,
    sha: createHash('sha256').update(value).digest('hex'),
  }))
  .concat([{ path: 'content/media/large-private-fixture.mp4', bytes: size, sha }]);
const bundle = async (entry?: string, contents?: string) =>
  (
    await build({
      ...(entry
        ? { entryPoints: [entry] }
        : { stdin: { contents: contents!, resolveDir: process.cwd(), loader: 'ts' } }),
      bundle: true,
      platform: 'browser',
      target: 'es2022',
      format: 'iife',
      write: false,
    })
  ).outputFiles[0].text;
const exporter = await bundle('src/console/cloud-backup.worker.ts');
const verifier = await bundle(
  undefined,
  `import {ArchiveReader} from './src/shared/browser-archive.ts';import {sha256} from '@noble/hashes/sha2.js';import {bytesToHex} from '@noble/hashes/utils.js';
onmessage=async e=>{try{const archive=new Blob(e.data.parts),reader=new ArchiveReader(archive.stream().pipeThrough(new DecompressionStream('gzip')));const first=await reader.header();if(first?.name!=='manifest.json')throw Error('Missing manifest');const manifest=JSON.parse(new TextDecoder().decode(await reader.bytes(first.size)));await reader.padding(first.size);let bytes=0,maxChunk=0,largeHash='';for(const record of manifest.files){const next=await reader.header();if(next?.name!=='data/'+record.path||next.size!==record.bytes)throw Error('Wrong file identity or length');const hash=sha256.create();let read=0;while(read<next.size){const part=await reader.take(Math.min(8*1024**2,next.size-read));hash.update(part);read+=part.length;maxChunk=Math.max(maxChunk,part.length);}const actual=bytesToHex(hash.digest());if(actual!==record.sha256)throw Error('Checksum mismatch');if(read===e.data.size){bytes=read;largeHash=actual;}await reader.padding(next.size);}if(await reader.header())throw Error('Unexpected files');await reader.close();postMessage({sha:largeHash,bytes,maxChunk,archiveBytes:archive.size,parts:e.data.parts.length,manifestFiles:manifest.files.length});}catch(error){postMessage({error:error.message});}};`,
);
const server = createServer((request, response) => {
  const url = new URL(request.url!, 'http://fixture');
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Disposable Glass archive benchmark</title>');
  } else if (url.pathname === '/export.js' || url.pathname === '/verify.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(url.pathname === '/export.js' ? exporter : verifier);
  } else if (url.pathname.endsWith('/manifest')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ portable: true, files }));
  } else if (url.pathname.endsWith('/file')) {
    const setting = settings.get(url.searchParams.get('path') || '');
    if (setting) {
      response.end(setting);
      return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', size);
    Readable.from(
      (async function* () {
        for (let offset = 0; offset < size; offset += block.length)
          yield block.subarray(0, Math.min(block.length, size - offset));
      })(),
    ).pipe(response);
  } else {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-browser-storage-benchmark-'));
const context = await chromium.launchPersistentContext(profile),
  browser = context.browser()!,
  page = await context.newPage(),
  cdp = await browser.newBrowserCDPSession();
let peak = 0,
  samples = 0,
  sampling = false;
const sample = async () => {
  if (sampling) return;
  sampling = true;
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const ids = processInfo
      .map((p: { id: number }) => p.id)
      .filter((n: number) => Number.isSafeInteger(n) && n > 0);
    if (ids.length) {
      const output = await run('ps', ['-o', 'rss=', '-p', ids.join(',')]);
      const kib = output.stdout
        .trim()
        .split(/\s+/)
        .reduce((sum, v) => sum + (Number(v) || 0), 0);
      peak = Math.max(peak, kib * 1024);
      samples++;
    }
  } catch {
  } finally {
    sampling = false;
  }
};
const started = Date.now(),
  timer = setInterval(() => void sample(), 500);
try {
  const address = server.address() as { port: number };
  await page.addInitScript({ content: 'window.__name=(fn)=>fn;' });
  await page.goto('http://127.0.0.1:' + address.port);
  const result = await page.evaluate(
    async ({ id, session, size }) =>
      await new Promise<any>((resolve, reject) => {
        const worker = new Worker('/export.js'),
          verifier = new Worker('/verify.js');
        const stop = () => {
          worker.terminate();
          verifier.terminate();
        };
        worker.onerror = (e) => {
          stop();
          reject(Error(e.message));
        };
        verifier.onerror = (e) => {
          stop();
          reject(Error(e.message));
        };
        worker.onmessage = (e) => {
          if (e.data.type === 'error') {
            stop();
            reject(Error(e.data.message));
          }
          if (e.data.type === 'parts') verifier.postMessage({ parts: e.data.parts, size });
          if (e.data.type === 'cleaned') {
            stop();
            resolve((window as any).verification);
          }
        };
        verifier.onmessage = (e) => {
          if (e.data.error) {
            stop();
            reject(Error(e.data.error));
            return;
          }
          (window as any).verification = e.data;
          worker.postMessage({ action: 'cleanup', session });
        };
        worker.postMessage({
          action: 'export',
          id,
          kind: 'export',
          session,
          token: 'fixture-only',
          streaming: false,
        });
      }),
    { id, session, size },
  );
  await sample();
  assert.equal(result.sha, sha);
  assert.equal(result.bytes, size);
  assert.equal(result.manifestFiles, 3);
  assert.ok(result.maxChunk <= 8 * 1024 ** 2);
  if (size > 2 * 1024 ** 3) assert.ok(result.archiveBytes > 2 * 1024 ** 3);
  assert.ok(samples > 0, 'No browser memory samples were collected.');
  assert.ok(
    peak < 1024 ** 3,
    'Browser process tree exceeded 1 GiB: ' + Math.round(peak / 1024 ** 2) + ' MiB.',
  );
  console.log(
    JSON.stringify({
      ...result,
      peakBrowserRssMiB: Math.round(peak / 1024 ** 2),
      memorySamples: samples,
      seconds: Math.round((Date.now() - started) / 1000),
      verified:
        'real Chromium export worker, OPFS parts, gzip trailer, incremental SHA-256 and streamed restore; no live R2 or Worker CPU claim',
    }),
  );
} finally {
  clearInterval(timer);
  await context.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(profile, { recursive: true, force: true });
}
