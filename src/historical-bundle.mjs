/** Load the exact frozen artifacts from a lossless, server-only local bundle. No network or writes. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {FROZEN_FILES,buildHistoricalEvaluation} from './historical-evaluation.mjs';

export const HISTORICAL_BUNDLE_DIR=fileURLToPath(new URL('../data/historical-2025/',import.meta.url));
export function loadBundledHistoricalEvaluation({read=readFileSync,directory=HISTORICAL_BUNDLE_DIR}={}){
  const objects=[];
  for(const [name,expected] of Object.entries(FROZEN_FILES)){
    const compressed=read(join(directory,name+'.gz'));
    if(compressed.length>2_000_000)throw Error('HISTORICAL_BUNDLE_TOO_LARGE');
    const bytes=gunzipSync(compressed,{maxOutputLength:8_000_000});
    if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('FROZEN_HISTORICAL_HASH_MISMATCH');
    objects.push(JSON.parse(bytes));
  }
  return buildHistoricalEvaluation(...objects);
}
let retained;
export function getBundledHistoricalEvaluation(){
  // Cache only successfully verified projections. Missing/corrupt bundles always fail closed.
  if(!retained)retained=loadBundledHistoricalEvaluation();
  return retained;
}
