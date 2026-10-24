import exif from 'exif-reader';
import type { CameraInfo } from '../shared/media-details.js';
/** Only the public camera vocabulary; never raw EXIF, GPS or owner information. */
export function cameraFromExif(buffer?: Buffer): CameraInfo {
  const camera: CameraInfo = {};
  try {
    if (!buffer || buffer.length > 1024 * 1024) return camera;
    const data = exif(buffer),
      image = data.Image || {},
      photo = data.Photo || {};
    const text = (value: unknown) =>
      typeof value === 'string'
        ? value
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim()
            .slice(0, 160)
        : '';
    for (const [key, value] of [
      ['make', image.Make],
      ['model', image.Model],
      ['lens', photo.LensModel],
    ] as const) {
      const safe = text(value);
      if (safe) camera[key] = safe;
    }
    const number = (value: unknown, max = 1000000) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
        ? value
        : undefined;
    const exposure = number(photo.ExposureTime, 86400),
      aperture = number(photo.FNumber, 256),
      iso = number(photo.ISOSpeedRatings || photo.ISOSpeed),
      focal = number(photo.FocalLength, 100000),
      equivalent = number(photo.FocalLengthIn35mmFilm, 100000);
    if (exposure)
      camera.exposure =
        exposure < 1 ? '1/' + Math.round(1 / exposure) + ' s' : Number(exposure.toFixed(3)) + ' s';
    if (aperture) camera.aperture = 'f/' + Number(aperture.toFixed(2));
    if (iso) camera.iso = String(Math.round(iso));
    if (focal) camera.focalLength = Number(focal.toFixed(1)) + ' mm';
    if (equivalent) camera.equivalentFocalLength = Number(equivalent.toFixed(1)) + ' mm';
  } catch {
    /* Missing or malformed metadata does not prevent image viewing. */
  }
  return camera;
}
