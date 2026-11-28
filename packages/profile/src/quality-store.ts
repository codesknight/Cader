import{open}from'node:fs/promises';

// Full native/visual evidence is private runtime data, not model context.
export const QUALITY_MANIFEST_MAX_BYTES=256*1024*1024;
export async function readQualityManifest(path:string,maxBytes=QUALITY_MANIFEST_MAX_BYTES){
 const file=await open(path,'r'),chunks:Buffer[]=[];let total=0;
 try{
  const info=await file.stat();if(!info.isFile())throw Error('QUALITY_MANIFEST_INVALID');if(info.size>maxBytes)throw Error('QUALITY_MANIFEST_TOO_LARGE');
  for(;;){const chunk=Buffer.allocUnsafe(Math.min(65536,maxBytes-total+1)),{bytesRead}=await file.read(chunk,0,chunk.length,null);if(!bytesRead)break;total+=bytesRead;if(total>maxBytes)throw Error('QUALITY_MANIFEST_TOO_LARGE');chunks.push(chunk.subarray(0,bytesRead));}
 }finally{await file.close();}
 const raw=Buffer.concat(chunks,total).toString('utf8');let saved:any;
 try{saved=JSON.parse(raw);if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Invalid root');}catch(error){throw Error('QUALITY_MANIFEST_INVALID',{cause:error});}
 return {raw,saved};
}
