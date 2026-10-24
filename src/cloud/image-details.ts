import { Buffer } from 'node:buffer';
import { cameraFromExif } from '../engine/exif-camera.js';
import type { CameraInfo } from '../shared/media-details.js';

/** Read only EXIF segments contained in the bounded prefix; never scan pixel data. */
export function cameraFromImageHeader(value: Uint8Array): CameraInfo {
  const data = Buffer.from(value);
  try {
    if (data[0] === 255 && data[1] === 216) {
      for (let offset = 2, count = 0; offset + 4 < data.length && count++ < 128;) {
        if (data[offset] !== 255) return {};
        const marker = data[offset + 1];
        if (marker === 218 || marker === 217) return {};
        if (marker === 255) {
          offset++;
          continue;
        }
        const length = data.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > data.length) return {};
        const bytes = data.subarray(offset + 4, offset + 2 + length);
        if (marker === 225 && bytes.toString('ascii', 0, 6) === 'Exif\0\0')
          return cameraFromExif(bytes);
        offset += length + 2;
      }
    } else if (data.toString('ascii', 1, 4) === 'PNG') {
      for (let offset = 8; offset + 12 <= data.length;) {
        const size = data.readUInt32BE(offset);
        if (offset + 12 + size > data.length) return {};
        if (data.toString('ascii', offset + 4, offset + 8) === 'eXIf')
          return cameraFromExif(data.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
      }
    } else if (
      data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP'
    ) {
      for (let offset = 12; offset + 8 <= data.length;) {
        const size = data.readUInt32LE(offset + 4);
        if (offset + 8 + size > data.length) return {};
        if (data.toString('ascii', offset, offset + 4) === 'EXIF')
          return cameraFromExif(data.subarray(offset + 8, offset + 8 + size));
        offset += 8 + size + (size % 2);
      }
    } else if (['II', 'MM'].includes(data.toString('ascii', 0, 2))) return cameraFromExif(data);
  } catch {
    /* Optional metadata cannot prevent viewing an image. */
  }
  return {};
}
