/** Offline preparation receipts. These never authorize or perform publication. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {summarizeEvidence} from './evidence.mjs';
import {verifyAppendOnlyEvidence} from './evidence-transition.mjs';

const commitPattern=/^[0-9a-f]{40}$/;
const digestPattern=/^[0-9a-f]{64}$/;
export const candidateSha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
const parse=text=>{
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>3000000)throw Error('INVALID_CANDIDATE_BYTES');
  return JSON.parse(text);
};
export function assertSettlementPreparation({event,ref,operation,sourceUseConfirmed,
  expectedSourceCommit,actualSourceCommit,currentMainCommit}){
  if(event!=='workflow_dispatch'||ref!=='refs/heads/main'||operation!=='prepare')
    throw Error('EXPLICIT_MAIN_PREPARATION_REQUIRED');
  if(sourceUseConfirmed!==true)throw Error('SOURCE_USE_CONFIRMATION_REQUIRED');
  if(!commitPattern.test(expectedSourceCommit??'')||expectedSourceCommit!==actualSourceCommit||
    expectedSourceCommit!==currentMainCommit)throw Error('PINNED_MAIN_REVISION_MISMATCH');
  return {preparationAllowed:true,publicationAuthorized:false};
}
export function createSettlementCandidate({sourceCommit,preparedAt,previousText,journalText}){
  if(!commitPattern.test(sourceCommit??''))throw Error('INVALID_SOURCE_COMMIT');
  const now=Date.parse(preparedAt);
  if(!Number.isFinite(now)||new Date(now).toISOString()!==preparedAt)throw Error('INVALID_PREPARATION_TIME');
  const previous=parse(previousText),journal=parse(journalText);
  const transition=verifyAppendOnlyEvidence(previous,journal,{allowNewSnapshots:false});
  const summaryText=JSON.stringify(summarizeEvidence(journal,now),null,2)+'\n';
  return {schema:'betq-settlement-candidate-v1',publicationAuthorized:false,sourceCommit,preparedAt,
    journalPath:'data/evidence/nfl-'+journal.season+'.json',
    baselineSha256:candidateSha256(previousText),journalSha256:candidateSha256(journalText),
    journalText,summaryText,summarySha256:candidateSha256(summaryText),transition};
}
export function serializeSettlementCandidate(bundle){
  const text=JSON.stringify(bundle,null,2)+'\n';
  if(Buffer.byteLength(text,'utf8')>3000000)throw Error('CANDIDATE_TOO_LARGE');
  return text;
}
export function verifySettlementCandidate(text,{expectedSha256,expectedSourceCommit,previousText}){
  if(!digestPattern.test(expectedSha256??'')||candidateSha256(text)!==expectedSha256)
    throw Error('REVIEWED_CANDIDATE_DIGEST_MISMATCH');
  const bundle=parse(text);
  if(!commitPattern.test(expectedSourceCommit??'')||bundle.sourceCommit!==expectedSourceCommit)
    throw Error('CANDIDATE_SOURCE_COMMIT_MISMATCH');
  const recreated=createSettlementCandidate({sourceCommit:expectedSourceCommit,
    preparedAt:bundle.preparedAt,previousText,journalText:bundle.journalText});
  if(!isDeepStrictEqual(bundle,recreated))throw Error('CANDIDATE_CONTENT_OR_BASELINE_MISMATCH');
  return {verified:true,publicationAuthorized:false,sourceCommit:bundle.sourceCommit,
    candidateSha256:expectedSha256,...bundle.transition};
}
