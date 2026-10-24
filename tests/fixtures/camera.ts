import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp: typeof import('sharp').default = require('sharp');
export async function cameraPicture() {
  return sharp({ create: { width: 640, height: 360, channels: 3, background: '#405c7e' } })
    .jpeg()
    .withExif({
      IFD0: {
        Make: 'Test Camera',
        Model: 'Lens Study',
        Artist: 'Private photographer',
        Copyright: 'Private owner',
      },
      IFD2: {
        LensModel: 'A small lens',
        ExposureTime: '1/125',
        FNumber: '28/10',
        ISOSpeedRatings: '400',
        FocalLength: '35/1',
        BodySerialNumber: 'PRIVATE-SERIAL',
        CameraOwnerName: 'Private owner',
        UserComment: 'Private note',
      },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '31/1 12/1 1/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '121/1 1/1 1/1',
      },
    })
    .toBuffer();
}
