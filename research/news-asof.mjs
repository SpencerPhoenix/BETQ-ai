// Offline research only. No network, probability adjustment, or production import.
// Input attestations must come from an independent source/custody reviewer.
// This function checks internal consistency; it DOES NOT authenticate those attestations.
import {createHash} from 'node:crypto';
const text = (v,n=160) => typeof v==='string' && v.length>0 && v.length<=n && v.trim()===v && !/[\u0000-\u001f\u007f]/.test(v);
const sourceURL = v => {try {const u=new URL(v);return text(v,2048)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;}catch{return false;}};
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? Date.parse(v) : NaN;
export function classifyNews(record, game, cutoff, mode='prospective', sourceBytes) {
  const reject = reason => ({eligible:false,reason,probabilitiesAdjusted:false,sourceAuthenticityVerified:false});
  if (!['prospective','historical-reconstruction'].includes(mode)) return reject('INVALID_MODE');
  const cut=time(cutoff), kick=time(game?.kickoffAt);
  if(!Number.isFinite(cut)||!Number.isFinite(kick)||cut>=kick) return reject('INVALID_CUTOFF');
  if(!game || ![game.id,game.home,game.away].every(v=>text(v)) || game.home===game.away) return reject('INVALID_GAME');
  if(!record || !text(record.playerId)||!text(record.reviewerId)||!text(record.versionEvidenceRef,2048)) return reject('MISSING_REVIEW_IDENTITY');
  if(record.gameId!==game.id || record.home!==game.home || record.away!==game.away || record.kickoffAt!==game.kickoffAt || ![game.home,game.away].includes(record.team)) return reject('IDENTITY_MISMATCH');
  if(record.reviewStatus!=='VERIFIED_SOURCE_FACT'||!['QB_OUT','QB_STARTER_CONFIRMED','PLAYER_OUT','PLAYER_QUESTIONABLE'].includes(record.factType))return reject('UNREVIEWED_OR_UNSUPPORTED');
  if(!/^[a-f0-9]{64}$/.test(record.bodySha256)||!sourceURL(record.sourceUrl)||record.sourceApproved!==true)return reject('SOURCE_NOT_APPROVED');
  if(!(sourceBytes instanceof Uint8Array)||sourceBytes.byteLength===0||sourceBytes.byteLength>2*1024*1024||createHash('sha256').update(sourceBytes).digest('hex')!==record.bodySha256)return reject('SOURCE_BYTES_MISMATCH');
  const pub=time(record.publishedAt),obs=time(record.firstObservedAt),review=time(record.reviewedAt);
  if(![pub,obs,review].every(Number.isFinite)||pub>obs||obs>review)return reject('INVALID_CHRONOLOGY');
  if(pub>cut)return reject('PUBLISHED_AFTER_CUTOFF');
  // A current copy of an old article may contain later revisions.
  const version=time(record.versionAvailableAt);
  if(!Number.isFinite(version)||version<pub||version>obs||version>cut||record.versionEvidenceVerified!==true)return reject('CONTENT_VERSION_NOT_PROVEN_AT_CUTOFF');
  if(mode==='prospective' && (obs>cut||review>cut))return reject('NOT_OBSERVED_AND_REVIEWED_AT_CUTOFF');
  return {eligible:true,mode,evidenceLevel:'CONSISTENT_REVIEW_ATTESTATIONS_ONLY',sourceAuthenticityVerified:false,firstObservedAt:record.firstObservedAt,publishedAt:record.publishedAt,
    requiresProspectiveCustodyVerification:mode==='prospective',probabilitiesAdjusted:false,
    caveat:mode==='historical-reconstruction'?'ARCHIVED_CONTENT_RECONSTRUCTION_NOT_HISTORICAL_BETQ_CAPTURE':null};
}
