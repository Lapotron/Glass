export const cameraLabels = {
  make: 'Camera make',
  model: 'Camera model',
  lens: 'Lens',
  exposure: 'Exposure',
  aperture: 'Aperture',
  iso: 'ISO',
  focalLength: 'Focal length',
  equivalentFocalLength: '35mm equivalent',
} as const;
export type CameraInfo = Partial<Record<keyof typeof cameraLabels, string>>;
export type ImageDetails = {
  name: string;
  displayName?: string;
  downloadName?: string;
  shortUrl?: string;
  url: string;
  bytes: number;
  format: string;
  width?: number;
  height?: number;
  camera: CameraInfo;
};
export type StudioImageDetails = ImageDetails & {
  publishCameraExif: boolean;
  libraryRevision: string;
};
export type MediaDetailsManifest = { version: 1; images: Record<string, ImageDetails> };
export function canonicalMediaUrl(value: string) {
  if (!value.startsWith('/media/')) throw new Error('Choose a local media image.');
  const name = decodeURIComponent(value.slice(7).split(/[?#]/)[0]);
  if (!name || /[/\\\0]/.test(name) || name === '.' || name === '..')
    throw new Error('Invalid media image path.');
  return '/media/' + encodeURIComponent(name);
}
export function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + ' MiB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KiB';
}
