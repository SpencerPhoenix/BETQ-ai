#!/usr/bin/env node
/** Fixed-path offline preparation/verification; never fetches, commits or publishes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {nflSeasonAt} from '../src/settlement-only.mjs';
import {assertSettlementPreparation,createSettlementCandidate,serializeSettlementCandidate,
  candidateSha256,verifySettlementCandidate} from '../src/settlement-candidate.mjs';

const args=process.argv.slice(2);
if(args.length!==1||!['preflight','prepare','verify'].includes(args[0]))
  throw Error('ONLY_PREFLIGHT_PREPARE_OR_VERIFY_SUPPORTED');
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:6000000}).trimEnd();
const head=git(['rev-parse','HEAD']);
const expected=process.env.EXPECTED_SOURCE_SHA;
const path='audit-output/settlement-candidate.json';
const previousText=file=>execFileSync('git',['show','HEAD:'+file],{encoding:'utf8',maxBuffer:3000000});
if(args[0]==='verify'){
  if(expected!==head)throw Error('PINNED_CHECKOUT_REQUIRED');
  const text=await readFile(path,'utf8');
  if(Buffer.byteLength(text,'utf8')>3000000)throw Error('CANDIDATE_TOO_LARGE');
  const file=JSON.parse(text).journalPath;
  if(typeof file!=='string'||!/^data\/evidence\/nfl-\d{4}\.json$/.test(file))throw Error('INVALID_CANDIDATE_PATH');
  console.log(JSON.stringify(verifySettlementCandidate(text,{expectedSha256:process.env.EXPECTED_CANDIDATE_SHA256,
    expectedSourceCommit:head,previousText:previousText(file)}),null,2));
}else{
  assertSettlementPreparation({event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,
    operation:process.env.SETTLEMENT_OPERATION,sourceUseConfirmed:process.env.SOURCE_USE_CONFIRMED==='true',
    expectedSourceCommit:expected,actualSourceCommit:head,currentMainCommit:process.env.CURRENT_MAIN_SHA});
  if(process.env.GITHUB_SHA!==head)throw Error('DISPATCH_CHECKOUT_MISMATCH');
  if(args[0]==='preflight'){
    if(git(['status','--porcelain','--untracked-files=no']))throw Error('CLEAN_PINNED_CHECKOUT_REQUIRED');
    console.log('PASS explicit preparation approval and clean pinned main revision; publication is disabled.');
  }else{
    const preparedAt=new Date().toISOString();
    const file='data/evidence/nfl-'+nflSeasonAt(Date.now())+'.json';
    const changed=git(['diff','--name-only','HEAD']).split('\n').filter(Boolean);
    if(changed.some(p=>p!==file&&p!=='data/evidence/summary.json'))throw Error('UNEXPECTED_PREPARATION_CHANGE');
    const baseline=previousText(file);
    const bundle=createSettlementCandidate({sourceCommit:head,preparedAt,
      previousText:baseline,journalText:await readFile(file,'utf8')});
    const text=serializeSettlementCandidate(bundle);
    const digest=candidateSha256(text);
    verifySettlementCandidate(text,{expectedSha256:digest,expectedSourceCommit:head,previousText:baseline});
    await mkdir('audit-output',{recursive:true});
    await writeFile(path,text,{encoding:'utf8',flag:'wx'});
    console.log(JSON.stringify({candidatePath:path,candidateSha256:digest,
      sourceCommit:head,preparedAt,publicationAuthorized:false,
      providerRequests:0,...bundle.transition},null,2));
  }
}
