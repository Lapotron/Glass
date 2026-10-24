import { runTool, type ToolOptions, type ToolResult } from './operations.js';
import {
  base64Encode,
  decryptContent,
  encryptContent,
  type EncryptedMetadata,
} from '../../shared/tools-crypto.js';
import { isToolId, toolLimits, type ToolId } from '../../shared/tools-catalog.js';
export type DeveloperRequest =
  | { id: number; kind: 'tool'; tool: ToolId; source: string; options: ToolOptions }
  | {
      id: number;
      kind: 'encrypt' | 'decrypt' | 'hash-file' | 'base64-file';
      bytes: ArrayBuffer;
      password?: string;
      metadata?: EncryptedMetadata;
      algorithm?: string;
      urlSafe?: boolean;
    };
self.addEventListener('message', async (event: MessageEvent<DeveloperRequest>) => {
  const request = event.data;
  if (!request || !Number.isSafeInteger(request.id)) return;
  try {
    let result: ToolResult;
    if (request.kind === 'tool') {
      if (!isToolId(request.tool)) throw new Error('Choose a developer tool.');
      result = await runTool(request.tool, request.source, request.options);
    } else {
      if (
        !(request.bytes instanceof ArrayBuffer) ||
        request.bytes.byteLength > toolLimits.fileBytes + 4096
      )
        throw new Error('Files support up to 25 MiB.');
      const bytes = new Uint8Array(request.bytes);
      if (request.kind === 'encrypt') {
        const encrypted = await encryptContent(bytes, request.password || '', request.metadata!);
        result = {
          text:
            request.metadata?.kind === 'text' ? 'glassenc:v1:' + base64Encode(encrypted, true) : '',
          bytes: encrypted.buffer,
          filename: request.metadata?.kind === 'text' ? 'message.glassenc' : 'encrypted.glassenc',
          mime: 'application/octet-stream',
        };
      } else if (request.kind === 'decrypt') {
        const decrypted = await decryptContent(bytes, request.password || '');
        result =
          decrypted.metadata.kind === 'text'
            ? {
                text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
                  decrypted.bytes,
                ),
              }
            : {
                text: '',
                bytes: decrypted.bytes.buffer,
                filename: decrypted.metadata.name,
                mime: decrypted.metadata.mime || 'application/octet-stream',
              };
      } else if (request.kind === 'base64-file')
        result = { text: base64Encode(bytes, request.urlSafe) };
      else if (request.kind === 'hash-file') {
        const algorithm = ['SHA-256', 'SHA-384', 'SHA-512'].includes(request.algorithm || '')
          ? request.algorithm!
          : 'SHA-256';
        const hash = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
        result = { text: [...hash].map((n) => n.toString(16).padStart(2, '0')).join('') };
      } else throw new Error('Choose a developer tool.');
      bytes.fill(0);
    }
    self.postMessage({ id: request.id, result }, { transfer: result.bytes ? [result.bytes] : [] });
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'The operation could not finish.',
    });
  }
});
