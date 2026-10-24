import sharp from 'sharp';
import type { CameraInfo } from '../shared/media-details.js';
import { cameraFromExif } from './exif-camera.js';

/** Never return raw EXIF: originals can contain locations, owner data and serials. */
export async function cameraInformation(bytes: Buffer): Promise<CameraInfo> {
  try {
    return cameraFromExif((await sharp(bytes, { limitInputPixels: 40000000 }).metadata()).exif);
  } catch {
    return {};
  }
}
