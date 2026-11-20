/** Collector-only display projection. Frozen V2 validation and old receipts stay unchanged. */
export function projectModelOnlyResponse(response) {
 const projected=structuredClone(response);
 if(!projected||typeof projected!=='object'||Array.isArray(projected))throw Error('MODEL_ONLY_PROJECTION_INVALID');
 if(!Object.hasOwn(projected,'depthContext'))return projected;
 const d=projected.depthContext;
 const allowed=new Set('available starterVerified probabilitiesAdjusted reason teams sourceUrl sourceLoadAt collectedAt sourceSha256 validUntil caveat'.split(' '));
 // This is a shape/safety boundary, NOT validation or endorsement of depth data.
 // It is discarded, never used as a feature, source receipt, or grading input.
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!allowed.has(k))||
   typeof d.available!=='boolean'||d.starterVerified!==false||d.probabilitiesAdjusted!==false||
   !(d.reason===null||typeof d.reason==='string')||!Array.isArray(d.teams)||d.teams.length>2||
   JSON.stringify(d).length>20000||d.teams.some(t=>!t||typeof t!=='object'||Array.isArray(t)||
     Object.keys(t).some(k=>!['team','player','playerId'].includes(k))||
     !['team','player'].every(k=>typeof t[k]==='string'&&t[k].length<=100)||
     !(typeof t.playerId==='string'&&t.playerId.length<=100||Number.isSafeInteger(t.playerId)&&t.playerId>=0&&t.playerId<=999999999999)))throw Error('MODEL_ONLY_PROJECTION_INVALID');
 delete projected.depthContext;
 // The existing receipt responseSha256 hashes this canonical forecast projection,
 // NOT the entire HTTP JSON body. No historic receipt schema or digest is changed.
 // All other fields remain byte-for-byte values for the existing exact-key,
 // model/artifact, source, time and probability checks in freezeModelOnlyReceipt.
 return projected;
}
