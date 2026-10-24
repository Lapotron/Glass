import { toolLimits } from './tools-catalog.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const magic = encoder.encode('GLASSENC\n');
const iterations = 600_000;
export const encryptedTextPrefix = 'glassenc:v1:';
export type EncryptedMetadata = { kind: 'text' | 'file'; name: string; mime: string };
export function base64Encode(bytes: Uint8Array, url = false) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const result = btoa(text);
  return url ? result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : result;
}
export function base64Decode(source: string, url = false): Uint8Array<ArrayBuffer> {
  source = source.replace(/\s/g, '');
  if (url) source = source.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 === 1)
    throw new Error('Invalid Base64 input.');
  const unpadded = source.replace(/=+$/, '');
  if (source.includes('=') && source.length % 4 !== 0) throw new Error('Invalid Base64 input.');
  let binary: string;
  try {
    binary = atob(unpadded);
  } catch {
    throw new Error('Invalid Base64 input.');
  }
  const result = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64Encode(result).replace(/=+$/, '') !== unpadded)
    throw new Error('Invalid Base64 input.');
  return result;
}
function combine(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
function sizePrefix(size: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
function cleanMetadata(value: unknown): EncryptedMetadata {
  if (!value || typeof value !== 'object') throw new Error('Invalid encrypted message.');
  const data = value as Record<string, unknown>;
  if (
    !['text', 'file'].includes(String(data.kind)) ||
    typeof data.name !== 'string' ||
    data.name.length > 255 ||
    typeof data.mime !== 'string' ||
    data.mime.length > 150
  )
    throw new Error('Invalid encrypted message.');
  return {
    kind: data.kind as 'text' | 'file',
    name:
      [...data.name]
        .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || /[\\/]/.test(c) ? '_' : c))
        .join('') || 'decrypted.bin',
    mime: data.mime,
  };
}
async function keyFor(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!password || encoder.encode(password).length > 1024)
    throw new Error('Enter a password between 1 and 1,024 bytes.');
  if (!globalThis.crypto?.subtle) throw new Error('Encryption requires HTTPS or localhost.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
/** V1: magic, big-endian header length, UTF-8 JSON header, authenticated ciphertext. */
export async function encryptContent(
  bytes: Uint8Array<ArrayBuffer>,
  password: string,
  metadata: EncryptedMetadata,
): Promise<Uint8Array<ArrayBuffer>> {
  metadata = cleanMetadata(metadata);
  if (bytes.length > (metadata.kind === 'text' ? toolLimits.textBytes : toolLimits.fileBytes))
    throw new Error('This input exceeds the tool size limit.');
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const header = encoder.encode(
    JSON.stringify({
      version: 1,
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: base64Encode(salt, true),
      iv: base64Encode(iv, true),
    }),
  );
  const aad = combine(magic, sizePrefix(header.length), header);
  const meta = encoder.encode(JSON.stringify(metadata));
  const payload = combine(sizePrefix(meta.length), meta, bytes);
  const key = await keyFor(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    payload,
  );
  payload.fill(0);
  return combine(aad, new Uint8Array(ciphertext));
}
export async function decryptContent(
  envelope: Uint8Array<ArrayBuffer>,
  password: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; metadata: EncryptedMetadata }> {
  if (
    envelope.length > toolLimits.fileBytes + 4096 ||
    envelope.length < magic.length + 4 + 16 ||
    !magic.every((byte, i) => envelope[i] === byte)
  )
    throw new Error('Invalid encrypted message.');
  const length = new DataView(envelope.buffer, envelope.byteOffset + magic.length, 4).getUint32(0);
  const end = magic.length + 4 + length;
  if (length > 1024 || end + 16 > envelope.length) throw new Error('Invalid encrypted message.');
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(decoder.decode(envelope.slice(magic.length + 4, end)));
    if (!header || typeof header !== 'object' || Array.isArray(header))
      throw new Error('Invalid encrypted message.');
  } catch {
    throw new Error('Invalid encrypted message.');
  }
  if (
    header.version !== 1 ||
    header.cipher !== 'AES-256-GCM' ||
    header.kdf !== 'PBKDF2-SHA256' ||
    header.iterations !== iterations ||
    typeof header.salt !== 'string' ||
    typeof header.iv !== 'string'
  )
    throw new Error('Unsupported encryption format.');
  const salt = base64Decode(header.salt, true),
    iv = base64Decode(header.iv, true);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encrypted message.');
  const key = await keyFor(password, salt);
  let plaintext: Uint8Array<ArrayBuffer>;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: envelope.slice(0, end), tagLength: 128 },
        key,
        envelope.slice(end),
      ),
    );
  } catch {
    throw new Error('Incorrect password or damaged encrypted content.');
  }
  try {
    const metaLength = new DataView(plaintext.buffer).getUint32(0);
    if (metaLength > 2048 || metaLength + 4 > plaintext.length)
      throw new Error('Invalid encrypted message.');
    const metadata = cleanMetadata(JSON.parse(decoder.decode(plaintext.slice(4, 4 + metaLength))));
    const bytes = plaintext.slice(4 + metaLength);
    if (bytes.length > (metadata.kind === 'text' ? toolLimits.textBytes : toolLimits.fileBytes))
      throw new Error('This input exceeds the tool size limit.');
    return { bytes, metadata };
  } finally {
    plaintext.fill(0);
  }
}
