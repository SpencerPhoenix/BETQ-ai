import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {parseOfficialClubReport,createOfficialInjuryReceipt,validateOfficialInjuryReceipt,reconcileOfficialInjuries,officialInjuryReviews,OFFICIAL_REVIEW_MAX_AGE_MS} from '../src/official-injury-review.mjs';
import {createHandler} from '../src/server.mjs';
const observedAt='2026-11-16T20:00:00.000Z',now=Date.parse(observedAt);
const context={gameId:'2026_10_LAC_BAL',season:2026,week:10,away:'LAC',home:'BAL',kickoff:'2026-11-17T01:15:00.000Z',observedAt};
const row=(name,status)=>`<tr><td><span class="d3-o-player-roster__player-name">${name}</span></td><td>WR</td><td>Test injury</td><td>DNP</td><td>DNP</td><td>DNP</td><td>${status}</td></tr>`;
const table=(team,rows)=>`<span class="nfl-o-injury-report__club-name">${team}</span><table><thead><tr><th>Player</th><th>Position</th><th>Injury</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Game Status</th></tr></thead><tbody>${rows}</tbody></table>`;
const html=`into the 2026 season<select><option value="/team/injury-report/week/REG-10" selected>WEEK 10</option></select>`+
  table('Los Angeles Chargers',row('Synthetic Receiver','OUT')+row('Other Player','(-)'))+table('Baltimore Ravens',row('Synthetic Raven','QUESTIONABLE'));
const receipt=()=>createOfficialInjuryReceipt(html,context);
const nf={season:2026,sourceUpdatedAt:'2026-11-16T17:00:00.000Z',reports:{'LAC:10':{flaggedPlayers:[{player:'Synthetic Receiver',status:'QUESTIONABLE'}]}}};
test('Official parser retains complete tables and distinguishes observation from publication',()=>{
 const r=receipt();assert.equal(r.reports.LAC.length,2);assert.equal(r.reports.LAC[1].status,'NO_GAME_STATUS');
 assert.equal(r.sourcePublishedAt,null);assert.equal(r.observedAt,observedAt);assert.match(r.bodySha256,/^[a-f0-9]{64}$/);
 assert.equal(validateOfficialInjuryReceipt(r),r);
});
test('Official parsing fails closed on wrong week, season, teams, columns, duplicates, status and missing table',()=>{
 for(const bad of [html.replace('REG-10','REG-11'),html.replace('2026 season','2025 season'),html.replace('Baltimore Ravens','Buffalo Bills'),
  html.replace('Game Status','Status'),html.replace('Other Player','Synthetic Receiver'),html.replace('OUT','EXPECTED'),
  html.slice(0,html.lastIndexOf('<span class="nfl-o-injury-report__club-name">')),html.replace('<tbody>','<broken>'),html.replace('d3-o-player-roster__player-name','unexpected-name')])
  assert.throws(()=>parseOfficialClubReport(bad,context));
 assert.throws(()=>parseOfficialClubReport('x'.repeat(1000001),context));
});
test('Receipts reject unsafe URLs, unknown fields, postgame or remote kickoff, invalid rows and fake publication times',()=>{
 for(const mutation of [r=>{r.sourceUrl='https://evil.test'},r=>{r.token='no'},r=>{r.observedAt=r.kickoff},r=>{r.kickoff='2026-11-29T01:15:00.000Z'},
  r=>{r.sourcePublishedAt=observedAt},r=>{r.reports.LAC[0].player='<script>'},r=>{r.reports.LAC.push(r.reports.LAC[0])},r=>{r.gameId='2026_10_BAL_LAC'}]){
   const r=receipt();mutation(r);assert.throws(()=>validateOfficialInjuryReceipt(r));
 }
});
test('Conflicts are explicit; unmatched names and no game status never imply healthy or changed probabilities',()=>{
 const r=receipt(),before=JSON.stringify(nf),out=reconcileOfficialInjuries(r,nf,{now});
 assert.equal(out.available,true);assert.equal(out.conflicts.length,1);assert.equal(out.unmatched.length,1);
 assert.equal(out.conflicts[0].officialStatus,'OUT');assert.equal(out.conflicts[0].nflverseStatus,'QUESTIONABLE');
 assert.equal(out.officialFlaggedPlayers.length,2);assert.equal(out.probabilitiesAdjusted,false);assert.equal(out.starterVerified,false);
 assert.equal(JSON.stringify(nf),before);assert.equal(out.sourcePublishedAt,null);
 assert.equal(reconcileOfficialInjuries(r,{...nf,season:2025},{now}).conflicts.length,0);
});
test('Future/expired/postgame observations suppress statuses, not relabel them current',()=>{
 const r=receipt();
 assert.equal(reconcileOfficialInjuries(r,nf,{now:now-1}).reason,'OFFICIAL_OBSERVATION_IN_FUTURE');
 assert.equal(reconcileOfficialInjuries(r,nf,{now:Date.parse(r.kickoff)}).reason,'GAME_STARTED');
 const early={...r,observedAt:'2026-11-16T12:00:00.000Z'};
 const expired=reconcileOfficialInjuries(early,nf,{now});assert.equal(expired.reason,'OFFICIAL_OBSERVATION_EXPIRED');assert.deepEqual(expired.conflicts,[]);assert.deepEqual(expired.officialFlaggedPlayers,[]);
 assert.equal(reconcileOfficialInjuries(early,nf,{now:Date.parse(early.observedAt)+OFFICIAL_REVIEW_MAX_AGE_MS}).available,false);
});
test('Receipt ledger refuses equal-time conflicts; future data cannot replace prior observation',()=>{
 const r=receipt(),changed=structuredClone(r);changed.reports.LAC[0].status='DOUBTFUL';
 assert.equal(officialInjuryReviews({schema:1,receipts:[r,changed]},nf,{now})[0].reason,'OFFICIAL_RECEIPT_CONFLICT');
 const later={...changed,observedAt:'2026-11-16T21:00:00.000Z'};
 assert.equal(officialInjuryReviews({schema:1,receipts:[r,later]},nf,{now})[0].conflicts[0].officialStatus,'OUT');
 assert.deepEqual(officialInjuryReviews({schema:1,receipts:Array(65).fill(r)},nf,{now}),[]);
});
test('Public injury endpoint exposes official contextual conflicts without odds requests',async t=>{
 let calls=0;
 const server=http.createServer(createHandler({clock:()=>now,officialInjuryArtifact:{schema:1,receipts:[receipt()]},
  injuryFeed:{get:async()=>({artifact:nf,status:{available:true}}),status:()=>({available:true})},
  source:{status:()=>({configured:true}),get:()=>{calls++;throw Error('Forbidden');}}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/injuries/nfl`);const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.officialReviews[0].conflicts.length,1);assert.equal(calls,0);
});

import {createOfficialInjuryFeed} from '../src/official-injury-feed.mjs';
test('Official public refresh is allowlisted, credential-free, coalesced and cached with no publication inference',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const feed=createOfficialInjuryFeed({fallbackArtifact:{schema:1,receipts:[receipt()]},clock:()=>now+1000,fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url,'https://www.chargers.com/team/injury-report/');assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.deepEqual(opts.headers,{Accept:'text/html'});
  await gate;return new Response(html,{headers:{'content-type':'text/html'}});
 }});
 const pending=Array.from({length:10},()=>feed.get());release();const values=await Promise.all(pending);
 assert.equal(calls,1);assert.equal(values[0].artifact.receipts[0].observedAt,new Date(now+1000).toISOString());
 assert.equal(values[0].artifact.receipts[0].sourcePublishedAt,null);assert.equal(values[0].status.durablyArchived,false);
 await feed.get();assert.equal(calls,1);assert.equal(values[0].status.providerCreditsUsed,0);
});
test('Failed official refresh retains receipt without resetting observed time; started games make no request',async()=>{
 let at=now+1000,calls=0;
 const feed=createOfficialInjuryFeed({fallbackArtifact:{schema:1,receipts:[receipt()]},clock:()=>at,fetchImpl:async()=>{calls++;return new Response('bad',{status:503});}});
 const out=await feed.get();assert.equal(out.artifact.receipts[0].observedAt,observedAt);assert.equal(out.status.lastSuccessAt,null);
 await feed.get();assert.equal(calls,1);
 at=Date.parse(context.kickoff);await feed.get();assert.equal(calls,1);
});
test('Wrong-week, oversized and non-HTML responses never replace retained official evidence',async()=>{
 for(const response of [()=>new Response(html.replace('REG-10','REG-11'),{headers:{'content-type':'text/html'}}),
  ()=>new Response('x'.repeat(1000001),{headers:{'content-type':'text/html'}}),()=>new Response(html,{headers:{'content-type':'application/json'}})]){
  const feed=createOfficialInjuryFeed({fallbackArtifact:{schema:1,receipts:[receipt()]},clock:()=>now+1000,fetchImpl:async()=>response()});
  const out=await feed.get();assert.equal(out.artifact.receipts[0].observedAt,observedAt);assert.equal(out.status.lastError,'OFFICIAL_REFRESH_FAILED_USING_RETAINED_OBSERVATION');
 }
});
