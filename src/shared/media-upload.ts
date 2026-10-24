import { z } from 'zod';
import { attachmentExtension, attachmentFile } from './attachments.js';
export const imageTransformSchema = z.object({
  crop: z
    .object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  resize: z
    .object({ width: z.number().int().min(1).max(2400), height: z.number().int().min(1).max(2400) })
    .optional(),
});
export const mediaSourceSchema = z.object({
  sourceId: z.uuid(),
  name: z.string().max(300),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  variants: z.array(
    z.object({
      name: z.string().regex(/^[\w-]+\.(?:webp|png)$/),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      transform: imageTransformSchema,
    }),
  ),
});
export function validMediaHeader(name: string, bytes: Uint8Array) {
  const ext = attachmentExtension(name),
    ascii = (at: number, length: number) =>
      new TextDecoder('latin1').decode(bytes.slice(at, at + length));
  if (!bytes.length) return false;
  if (ext === '.webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (ext === '.png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (ext === '.pdf') return ascii(0, 5) === '%PDF-';
  if (['.mp4', '.m4v', '.m4a'].includes(ext)) return ascii(4, 4) === 'ftyp';
  if (ext === '.mov') return ['ftyp', 'moov', 'mdat', 'wide'].includes(ascii(4, 4));
  if (ext === '.mp3')
    return ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224);
  if (ext === '.aac') return bytes[0] === 255 && (bytes[1] & 240) === 240;
  if (ext === '.wav') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
  if (ext === '.ogg') return ascii(0, 4) === 'OggS';
  if (ext === '.flac') return ascii(0, 4) === 'fLaC';
  if (ext === '.webm') return [26, 69, 223, 163].every((value, index) => bytes[index] === value);
  if (['.zip', '.docx', '.xlsx', '.pptx', '.epub'].includes(ext)) return ascii(0, 2) === 'PK';
  return attachmentFile(name) && !bytes.includes(0);
}
