// Synthetic offline source fixtures. No network or source licensing claims.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {collectOfficialResults,assertCredentialFree,readExactText} from '../scripts/collect-official-results.mjs';
import {emptyOfficialResultLedger} from '../src/official-result-ledger.mjs';
import {emptyJournal} from '../src/evidence.mjs';import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {PUBLIC_EVIDENCE_JOURNAL_URL} from '../src/evidence-journal-feed.mjs';
const now=Date.parse('2026-11-17T01:00:00.000Z');
function fixture(){const j={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};j.snapshots[0].gameId=j.settlements[0].gameId='2026_09_LV_KC';return j;}
function html(){
 const g={id:'synthetic-provider-1',season:2026,week:9,seasonType:'REG',time:'2026-11-08T18:00:00.000Z',neutralSite:false,status:'SCHEDULED',homeTeam:{id:'h',fullName:'Kansas City Chiefs'},awayTeam:{id:'a',fullName:'Las Vegas Raiders'},summary:{gameId:'synthetic-provider-1',phase:'FINAL',quarter:'END_OF_GAME',homeTeam:{teamId:'h',score:{total:27}},awayTeam:{teamId:'a',score:{total:17}}}};
 const state={queries:[{queryKey:['useFetchFootballWeeklyGameDetails',{season:'2026',week:9,seasonType:'REG'}],state:{status:'success',data:[g]}}]};
 return '<script>self.__next_f.push('+JSON.stringify([1,'2b:'+JSON.stringify(['$','component',null,{state}])+'\n'])+')</script>';
}
test('Collector uses only fixed public journal and official sources without credentials',async()=>{
 const calls=[],body='\ufeff'+html(),j=fixture();const fetchImpl=async(url,options)=>{calls.push([url,options]);return url===PUBLIC_EVIDENCE_JOURNAL_URL?new Response(JSON.stringify(j)):new Response(body,{headers:{'content-type':'text/html'}});};
 const r=await collectOfficialResults(emptyOfficialResultLedger(),{fetchImpl,clock:()=>now});assert.equal(r.report.degraded,false);assert.equal(r.ledger.entries.length,1);assert.equal(r.report.providerCreditsUsed,0);
 assert.equal(r.report.observedWeeks[0].sourceBodySha256,createHash('sha256').update(Buffer.from(body)).digest('hex'));
 assert.deepEqual(calls.map(x=>x[0]),[PUBLIC_EVIDENCE_JOURNAL_URL,'https://www.nfl.com/scores/2026/week-9']);
 for(const [,o] of calls){assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');assert.equal(o.headers.Authorization,undefined);}
 const again=await collectOfficialResults(r.ledger,{fetchImpl,clock:()=>now+1000});assert.equal(again.ledger.entries.length,1);
});
test('Failed official week is explicit and keeps durable observations unchanged',async()=>{
 const j=fixture(),fetchImpl=async url=>url===PUBLIC_EVIDENCE_JOURNAL_URL?new Response(JSON.stringify(j)):new Response('down',{status:503});
 const before=emptyOfficialResultLedger(),r=await collectOfficialResults(before,{fetchImpl,clock:()=>now});assert.deepEqual(r.ledger,before);assert.equal(r.report.degraded,true);assert.equal(r.report.failedWeeks.length,1);
});
test('Invalid journal blocks all official source reads, no bundled fallback',async()=>{
 let n=0;await assert.rejects(collectOfficialResults(emptyOfficialResultLedger(),{fetchImpl:async()=>{n++;return new Response('{}');},clock:()=>now}));assert.equal(n,1);
});
test('Exact source decoder preserves BOM and rejects malformed UTF8 and oversized streams',async()=>{
 const b=Buffer.from('\ufeffofficial');assert.equal(Buffer.from(await readExactText(new Response(b),100)).equals(b),true);
 await assert.rejects(readExactText(new Response(Uint8Array.from([255,254])),100));await assert.rejects(readExactText(new Response('12345'),4),/TOO_LARGE/);
});
test('Collection rejects provider/publisher tokens and workflow grants credentials only to publication',()=>{
 for(const key of ['GITHUB_TOKEN','GH_TOKEN','ODDS_API_KEY','BALLDONTLIE_API_KEY','Balldontlie_api_key'])assert.throws(()=>assertCredentialFree({[key]:'private'}),/CREDENTIALS_PRESENT/);
 const yaml=readFileSync(new URL('../.github/workflows/official-results.yml',import.meta.url),'utf8');assert.match(yaml,/cron: '17 \* \* \* \*'/);assert.match(yaml,/persist-credentials: false/);assert.equal((yaml.match(/GITHUB_TOKEN:/g)||[]).length,1);assert.match(yaml,/cancel-in-progress: false/);assert.ok(!yaml.includes('secrets.'));assert.match(yaml,/process.exitCode=1/);
});
test('Collection bounds parallel official requests to three and makes partial failure visible',async()=>{
 const j={...syntheticScoringJournal(6,0),provenance:emptyJournal(2026).provenance,settlements:[]};
 j.snapshots.forEach((s,i)=>{s.gameId=`2026_0${i+1}_LV_KC`;s.gameDate=`2026-10-0${i+1}`;s.commenceTime=s.gameDate+'T18:00:00.000Z';s.capturedAt='2026-09-30T12:00:00.000Z';s.modelLastResultDate='2026-09-28';s.modelBuiltAt='2026-09-29T11:00:00.000Z';s.sourceReceivedAt='2026-09-30T11:59:59.000Z';s.marketNewestQuoteAt=s.marketOldestQuoteAt='2026-09-30T11:59:58.000Z';s.challengerBuiltAt='2026-09-29T11:00:00.000Z';});
 let active=0,max=0;const fetchImpl=async url=>{if(url===PUBLIC_EVIDENCE_JOURNAL_URL)return new Response(JSON.stringify(j));active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return new Response('down',{status:503});};
 const r=await collectOfficialResults(emptyOfficialResultLedger(),{fetchImpl,clock:()=>now});assert.equal(max,3);assert.equal(r.report.failedWeeks.length,6);assert.equal(r.report.degraded,true);
});
