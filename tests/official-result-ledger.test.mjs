import test from 'node:test';import assert from 'node:assert/strict';
import {emptyOfficialResultLedger,validateOfficialResultLedger,appendOfficialResultObservations,assertOfficialResultLedgerAppend,latestOfficialResultObservations,validateOfficialResultReceipt} from '../src/official-result-ledger.mjs';
import {emptyJournal} from '../src/evidence.mjs';import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {parseOfficialWeeklyPage,officialWeeklyUrl} from '../src/nfl-official-finality.mjs';
import {reviewedResultDigest} from '../src/bdl-reviewed-result.mjs';
const start=Date.parse('2026-11-17T18:00:00.000Z'),copy=v=>JSON.parse(JSON.stringify(v));
function fixture(){const j={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};j.snapshots[0].gameId=j.settlements[0].gameId='2026_09_LV_KC';return j;}
function receipt(now=start,mutate=()=>{}){
 const g={id:'provider-kc-lv',season:2026,seasonType:'REG',week:9,time:'2026-11-08T18:00:00.000Z',neutralSite:false,status:'SCHEDULED',homeTeam:{id:'h',fullName:'Kansas City Chiefs'},awayTeam:{id:'a',fullName:'Las Vegas Raiders'},summary:{gameId:'provider-kc-lv',phase:'FINAL',quarter:'END_OF_GAME',homeTeam:{teamId:'h',score:{total:27}},awayTeam:{teamId:'a',score:{total:17}}}};
 mutate(g);const state={queries:[{queryKey:['useFetchFootballWeeklyGameDetails',{season:'2026',week:9,seasonType:'REG'}],state:{status:'success',data:[g]}}]};
 const payload='2b:'+JSON.stringify(['$','component',null,{state}])+'\n';
 return parseOfficialWeeklyPage('<script>self.__next_f.push('+JSON.stringify([1,payload])+')</script>',{season:2026,week:9,sourceUrl:officialWeeklyUrl(2026,9),observedAt:new Date(now).toISOString()});
}
const append=(l,j,r,now=start)=>appendOfficialResultObservations(l,j,[r],{now});
const select=(l,j,now=start)=>latestOfficialResultObservations(l,j,{now}).byGame.get('2026_09_LV_KC');
function rehash(l){let prev=null;for(const e of l.entries){e.previousHash=prev;const {entrySha256,...body}=e;e.entrySha256=reviewedResultDigest(body);prev=e.entrySha256;}return l;}
test('official observed ledger binds original snapshot and never mutates aggregate journal',()=>{
 const j=fixture(),before=JSON.stringify(j),l=emptyOfficialResultLedger(),out=append(l,j,receipt());
 assert.equal(l.entries.length,0);assert.equal(out.entries.length,1);assert.equal(JSON.stringify(j),before);assert.equal(validateOfficialResultLedger(out,start),out);
 const r=select(out,j);assert.equal(r.status,'FINAL');assert.equal(r.baselineSnapshotId,j.snapshots[0].id);assert.equal(r.baselineSnapshotSha256,reviewedResultDigest(j.snapshots[0]));assert.equal(r.aggregateScoringEligible,false);
 assert.equal(r.receipt.sourceBodySha256,receipt().sourceBodySha256);assert.equal(out.aggregateScoringEligible,false);
 // Old final receipts remain descriptive history; no fake refresh timestamp is supplied.
 assert.equal(select(out,j,start+86400000).receipt.observedAt,new Date(start).toISOString());
 r.receipt.games[0].homeScore=99;assert.equal(out.entries[0].receipt.games[0].homeScore,27);
});
test('unchanged polls with new hashes/times no-op, keeping original source observation',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt()),r=receipt(start+60000);r.sourceBodySha256='b'.repeat(64);
 const out=append(l,j,r,start+60000);assert.deepEqual(out,l);
});
test('new official correction appends and conflicting retained score suppresses prior grade',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt()),r=receipt(start+60000,g=>g.summary.homeTeam.score.total=20),out=append(l,j,r,start+60000);
 assert.equal(out.entries.length,2);assert.equal(select(out,j,start+60000).status,'SCORE_CONFLICT');assert.equal(select(out,j,start+60000).game.homeScore,20);assert.equal(l.entries[0].receipt.games[0].homeScore,27);
 assert.equal(assertOfficialResultLedgerAppend(l,out,{now:start+60000}),true);
});
test('withdrawn final and missing game never fall back to earlier final',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt());
 const nonfinal=receipt(start+60000,g=>{g.summary.phase='LIVE';g.summary.quarter='Q4';});
 assert.equal(select(append(l,j,nonfinal,start+60000),j,start+60000).status,'NOT_FINAL');
 const missing=receipt(start+60000,g=>{g.awayTeam.fullName='Denver Broncos';});
 assert.equal(select(append(l,j,missing,start+60000),j,start+60000).status,'MISSING_GAME');
});
test('official kickoff change holds identity without rewriting original forecast',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt()),r=receipt(start+60000,g=>g.time='2026-11-08T18:05:00.000Z');
 const out=append(l,j,r,start+60000);assert.equal(select(out,j,start+60000).status,'IDENTITY_CONFLICT');assert.equal(out.entries[1].bindings[0].frozenIdentity.commenceTime,j.snapshots[0].commenceTime);
});
test('provider identity change remains an explicit hold',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt()),r=receipt(start+60000,g=>{g.id='other-provider';g.summary.gameId=g.id;});
 assert.equal(select(append(l,j,r,start+60000),j,start+60000).status,'IDENTITY_CONFLICT');
});
test('changed, removed or later substituted baseline never earns old grade',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt()),changed=copy(j);changed.snapshots[0].modelHomeProbability=.8;
 assert.equal(select(l,changed).status,'BASELINE_CHANGED');assert.throws(()=>append(l,changed,receipt(start+60000),start+60000),/BASELINE_CHANGED/);
 const removed={...j,snapshots:[],settlements:[]};assert.equal(select(l,removed).status,'BASELINE_CHANGED');
 const subsequent=receipt(start+60000,g=>{g.awayTeam.fullName='Denver Broncos';});const out=append(l,removed,subsequent,start+60000);
 assert.equal(out.entries[1].bindings.length,1);assert.equal(select(out,j,start+60000).status,'MISSING_GAME');
});
test('same-time contradictory receipt and backdated source cannot revise history',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt());
 assert.throws(()=>append(l,j,receipt(start,g=>g.summary.homeTeam.score.total=20)),/REPLAY_OR_DUPLICATE/);
 assert.throws(()=>append(l,j,receipt(start-1),start),/BACKDATED_RECEIPT/);
 assert.throws(()=>append(l,j,receipt(start+1),start),/RECEIPT/);
 assert.throws(()=>append(emptyOfficialResultLedger(),j,receipt(start-300000),start),/STALE_APPEND/);
 assert.throws(()=>validateOfficialResultLedger(l,start-1),/RECEIPT|CHAIN/);
});
test('append-only proof rejects deletions and rehashed prior edits',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt()),edited=copy(l);edited.entries[0].receipt.sourceBodySha256='b'.repeat(64);rehash(edited);
 assert.throws(()=>assertOfficialResultLedgerAppend(l,emptyOfficialResultLedger(),{now:start}),/HISTORY_REWRITE/);
 assert.throws(()=>assertOfficialResultLedgerAppend(l,edited,{now:start}),/HISTORY_REWRITE/);
 const tampered=copy(l);tampered.entries[0].sequence=2;assert.throws(()=>validateOfficialResultLedger(tampered,start),/CHAIN/);
});
test('receipt boundaries reject extra/private fields and forged finality',()=>{
 for(const mutate of [r=>r.secret='private',r=>r.games[0].rawHtml='x',r=>r.sourceUrl='https://evil.test',r=>r.sourceBodySha256='bad',r=>r.aggregateScoringEligible=true,r=>r.sourceUpstreamIndependenceVerified=true,r=>r.games[0].summaryQuarter='Q4',r=>r.games[0].summaryPhase='FINAL_MAYBE',r=>r.games[0].homeScore='27',r=>r.games[0].providerGameId='\nID',r=>r.games.push(copy(r.games[0])),r=>r.observedAt='2026-02-30T12:00:00.000Z',r=>r.games[0].kickoff='2026-11-08T18:00:00Z']){
  const r=receipt();mutate(r);assert.throws(()=>validateOfficialResultReceipt(r,start));
 }
});
test('unknown ledger fields, broken hashes, malformed bindings and duplicate scopes fail closed',()=>{
 const j=fixture(),l=append(emptyOfficialResultLedger(),j,receipt());
 for(const mutate of [l=>l.rawSource='x',l=>l.aggregateScoringEligible=true,l=>l.entries[0].entrySha256='a'.repeat(64),l=>l.entries[0].bindings[0].frozenIdentity.home='BAL',l=>l.entries[0].bindings[0].privateKey='x']){
  const bad=copy(l);mutate(bad);assert.throws(()=>validateOfficialResultLedger(bad,start));
 }
 assert.throws(()=>appendOfficialResultObservations(l,j,[receipt(),receipt()],{now:start}),/DUPLICATE_WEEK/);
 assert.throws(()=>appendOfficialResultObservations(l,null,[receipt()],{now:start}),/INVALID_JOURNAL/);
});
test('team-prefix IDs use one deterministic ordering independent of locale',()=>{
 const j=fixture();j.settlements=[];const first=j.snapshots[0];
 j.snapshots=[{...first,id:'la',gameId:'2026_09_LA_ARI',home:'ARI',away:'LA',providerEventId:'la'},
  {...first,id:'lac',gameId:'2026_09_LAC_BAL',home:'BAL',away:'LAC',providerEventId:'lac'}];
 const r=receipt(),g=r.games[0];r.games=[{...g,gameId:'2026_09_LA_ARI',home:'ARI',away:'LA',providerGameId:'la'},
  {...g,gameId:'2026_09_LAC_BAL',home:'BAL',away:'LAC',providerGameId:'lac'}];
 const l=append(emptyOfficialResultLedger(),j,r);assert.equal(l.entries[0].bindings.length,2);assert.equal(latestOfficialResultObservations(l,j,{now:start}).byGame.size,2);
});
test('array side channels and getter fields are rejected without invoking getters',()=>{
 const r=receipt();r.games.privateKey='secret';assert.throws(()=>validateOfficialResultReceipt(r,start));
 const l=emptyOfficialResultLedger();l.entries.privateKey='secret';assert.throws(()=>validateOfficialResultLedger(l,start));
 let calls=0;const r2=receipt();Object.defineProperty(r2,'sourceUrl',{get(){calls++;return 'bad';},enumerable:true});assert.throws(()=>validateOfficialResultReceipt(r2,start));assert.equal(calls,0);
});
