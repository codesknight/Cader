import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readReferenceImage, ConfigError } from '@cader/config';

export interface ImageView { rotation?: 0 | 90 | 180 | 270; crop?: { left: number; top: number; width: number; height: number } }
export async function prepareImageView(root: string, path: string, view: ImageView = {}) {
  const source = await readReferenceImage(root, path);
  const crop = view.crop ?? { left: 0, top: 0, width: source.width, height: source.height };
  const rotation = view.rotation ?? 0;
  if (![0, 90, 180, 270].includes(rotation) || Object.values(crop).some(value => !Number.isSafeInteger(value))
    || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0
    || crop.left + crop.width > source.width || crop.top + crop.height > source.height)
    throw new ConfigError('Invalid original-pixel crop or rotation');
  // Explicit pixel coordinates: ignore EXIF orientation here, strip metadata on output.
  const metadata = await sharp(source.data).metadata();
  const transformed = await sharp(source.data, { limitInputPixels: 40_000_000 }).extract(crop).rotate(rotation)
    .png().toBuffer({ resolveWithObject: true });
  const { left: x, top: y, width: w, height: h } = crop;
  const matrix = rotation === 0 ? [1, 0, x, 0, 1, y] : rotation === 90 ? [0, 1, x, -1, 0, y + h]
    : rotation === 180 ? [-1, 0, x + w, 0, -1, y + h] : [0, -1, x + w, 1, 0, y];
  return { data: transformed.data, mediaType: 'image/png' as const,
    audit: { source_sha256: createHash('sha256').update(source.data).digest('hex'),
      source_width: source.width, source_height: source.height, source_media_type: source.mediaType,
      exif_orientation: metadata.orientation ?? null, orientation_policy: 'explicit-pixel-rotation',
      crop, rotation, view_width: transformed.info.width, view_height: transformed.info.height,
      view_sha256: createHash('sha256').update(transformed.data).digest('hex'),
      view_to_source: matrix, coordinates: 'continuous pixel edges, top-left origin' } };
}

export function attachmentToSource(viewMatrix: readonly number[], viewWidth: number, viewHeight: number,
  attachmentWidth: number, attachmentHeight: number) {
  return [viewMatrix[0]! * viewWidth / attachmentWidth, viewMatrix[1]! * viewHeight / attachmentHeight, viewMatrix[2]!,
    viewMatrix[3]! * viewWidth / attachmentWidth, viewMatrix[4]! * viewHeight / attachmentHeight, viewMatrix[5]!];
}
