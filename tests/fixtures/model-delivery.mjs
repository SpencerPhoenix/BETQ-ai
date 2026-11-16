// Offline test metadata only. Never writes or authorizes production model promotion.
import {readFileSync} from 'node:fs';
import {describeModelDelivery} from '../../src/model-delivery.mjs';
import {describeMarketCaptureContract} from '../../src/evidence-compat.mjs';
export const bundledDeliveryArtifact=JSON.parse(readFileSync(new URL('../../data/nfl_elo.json',import.meta.url),'utf8'));
export function syntheticDeliveryArtifact(builtAt,throughDate){
  const a=structuredClone(bundledDeliveryArtifact);a.generatedAt=builtAt;a.source.extractedUTC=builtAt;a.lastGameDate=throughDate;return a;
}
export function modelHealthFixture(artifact,now){return {status:'ok',app:'BETQ.ai',version:'0.11.0',serverTime:new Date(now).toISOString(),
  marketCaptureContract:describeMarketCaptureContract(),
  odds:{configured:true},nflModel:{available:true,deliveryIdentity:describeModelDelivery(artifact,now)},
  forwardEvidence:{status:'COLLECTING_FORWARD_EVIDENCE'},captureReadiness:{ready:true},collectionHealth:{liveFreshnessVerified:false}};}
