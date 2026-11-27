import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readReferenceImage, ConfigError } from '@cader/config';

export interface ImageView { rotation?: 0 | 90 | 180 | 270; crop?: { left: number; top: number; width: number; height: number } }
export interface CadCaptureRequest {world_window:[number,number,number,number];min_long_edge:number}
export interface CadReviewView extends CadCaptureRequest {sourceView?:ImageView;details?:{request:CadCaptureRequest;sourceView?:ImageView;entity_ids:number[]}[]}
/** Conservative clipping evidence for plotted CAD PNGs. A border hit is uncertainty,
 * never a claimed CAD coordinate transform or permission to repair geometry. */
export async function inspectCadImageBorder(path:string){
  const {data,info}=await sharp(path,{limitInputPixels:40_000_000}).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const at=(x:number,y:number)=>Array.from(data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3));
  const corners=[at(0,0),at(info.width-1,0),at(0,info.height-1),at(info.width-1,info.height-1)];
  const background=[0,1,2].map(c=>corners.map(p=>p[c]!).sort((a,b)=>a-b)[1]!);
  const ink=(x:number,y:number)=>at(x,y).some((v,c)=>Math.abs(v-background[c]!)>64);
  let hits=0;
  const band=Math.min(4,Math.floor(Math.min(info.width,info.height)/2));
  for(let offset=0;offset<band;offset++){
    for(let x=0;x<info.width;x++)for(const y of [offset,info.height-1-offset])if(ink(x,y))hits++;
    for(let y=band;y<info.height-band;y++)for(const x of [offset,info.width-1-offset])if(ink(x,y))hits++;
  }
  return {foreground_border_pixels:hits,possible_clipping:hits>0,method:'corner-background contrast; conservative uncertainty, not geometric mapping'};
}
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
