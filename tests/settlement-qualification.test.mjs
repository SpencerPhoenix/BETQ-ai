import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeEvidence} from '../src/evidence.mjs';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {summarizeDerivedForwardMarkets} from '../src/shadow-derived.mjs';
import {createEvidenceFeed,isValidEvidenceSummary} from '../src/evidence-feed.mjs';
import {isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const NOW=Date.parse('2026-11-16T12:00:00.000Z');
const summary=j=>summarizeEvidence(j,NOW);
function withheld(j,expected=0){
  const out=summary(j),sequential=calculateSequentialEvidence(j);
  assert.equal(out.sourceCorroboratedSettledGames,expected);
  assert.equal(out.sourceCorroboratedMarketGames,expected);
  assert.equal(out.sourceCorroboratedChallengerGames,expected);
  assert.equal(out.forwardMetrics,null);
  assert.equal(out.marketComparison,null);
  assert.equal(out.challengerForwardComparison,null);
  assert.equal(sequential.eligibleSettledNonTieGames,expected);
  assert.equal(sequential.properScores,null);
  assert.equal(sequential.candidateEvidence.fixedMixtureEvidence,null);
  assert.equal(isValidEvidenceSummary(out),true);
  return out;
}
test('30 community results remain visible but cannot unlock any outcome metric',()=>{
  const j=syntheticScoringJournal(30,0),before=JSON.stringify(j),out=withheld(j);
  assert.equal(out.settledGames,30);
  assert.equal(out.sourceUncorroboratedSettledGames,30);
  assert.equal(out.status,'COLLECTING_FORWARD_EVIDENCE');
  assert.ok(out.recentResults.every(r=>r.brier===null&&r.sourceCorroborated===false));
  assert.equal(calculateSequentialEvidence(j).exclusions.uncorroboratedSettlement,30);
  assert.equal(JSON.stringify(j),before);
});
test('Only corroborated outcomes enter all four 30-game score cohorts',()=>{
  const j=syntheticScoringJournal(35,30),before=JSON.stringify(j),out=summary(j);
  assert.equal(out.settledGames,35);
  assert.equal(out.sourceUncorroboratedSettledGames,5);
  for(const key of ['forwardMetrics','marketComparison','challengerForwardComparison'])assert.equal(out[key].n,30);
  assert.equal(calculateSequentialEvidence(j).properScores.n,30);
  assert.equal(out.sourceIndependenceVerified,false);
  assert.equal(out.marketBeatingEdgeEstablished,false);
  assert.equal(isValidEvidenceSummary(out),true);
  assert.equal(JSON.stringify(j),before);
  j.settlements[29].finalityAttestation=null;
  withheld(j,29);
});
const invalidCases={
  'missing source receipt':r=>delete r.communitySourceVintage,
  'missing finality receipt':r=>delete r.finalityAttestation,
  'unverified BDL cross-check':r=>{r.finalityAttestation.corroborator='BALLDONTLIE_NFL';r.finalityAttestation.status='CROSS_CHECKED_INDEPENDENCE_UNVERIFIED';},
  'wrong receipt game':r=>r.finalityAttestation.gameId='other-game',
  'wrong receipt date':r=>r.finalityAttestation.gameDate='2026-11-09',
  'wrong receipt score':r=>r.finalityAttestation.homeScore=28,
  'wrong record date':r=>{r.gameDate='2026-11-09';r.finalityAttestation.gameDate=r.gameDate;},
  'missing revision':r=>delete r.revision,
  'invalid community hash':r=>r.communitySourceVintage.sha256='not-a-hash',
  'invalid finality hash':r=>r.finalityAttestation.sourceSha256='not-a-hash',
  'invalid event ID':r=>r.finalityAttestation.eventId='unknown',
  'stale community receipt':r=>r.communitySourceVintage.collectorObservedAt='2026-11-15T10:59:59.999Z',
  'stale finality receipt':r=>r.finalityAttestation.observedAt='2026-11-15T10:59:59.999Z',
  'future receipt relative to reconciliation':r=>r.finalityAttestation.observedAt='2026-11-15T12:02:00.001Z',
  'noncanonical receipt':r=>r.finalityAttestation.observedAt='2026-11-15',
  'unsupported league certification':r=>r.finalityAttestation.officialLeagueCertification=true,
  'pre-kickoff receipts with post-kickoff verification':r=>{
    r.verifiedAt='2026-11-08T18:01:00.000Z';
    r.communitySourceVintage.collectorObservedAt='2026-11-08T17:30:00.000Z';
    r.finalityAttestation.observedAt='2026-11-08T17:30:00.000Z';
  }
};
for(const [label,mutate] of Object.entries(invalidCases))test('Fail closed: '+label,()=>{
  const j=syntheticScoringJournal(1);mutate(j.settlements[0]);withheld(j);
});
test('Valid historical receipts stay eligible without being treated as currently fresh data',()=>{
  const j=syntheticScoringJournal(1);
  assert.equal(isSourceCorroboratedSettlement(j.settlements[0],j.snapshots[0]),true);
  assert.equal(summarizeEvidence(j,Date.parse('2030-01-01T00:00:00Z')).sourceCorroboratedSettledGames,1);
});
test('Highest revision is selected before filtering even when journal order reverses',()=>{
  const j=syntheticScoringJournal(30),correction={...j.settlements[0],revision:2,finalityAttestation:null};
  for(const records of [[correction,...j.settlements],[...j.settlements,correction]]){
    const out=withheld({...j,settlements:records},29);
    assert.equal(out.settledGames,30);
  }
});
test('Same revision provenance ambiguity rejects both metric paths without changing bytes',()=>{
  const j=syntheticScoringJournal(30);
  j.settlements.push({...j.settlements[0],finalityAttestation:null});
  const before=JSON.stringify(j);
  assert.throws(()=>summary(j),/Contradictory/);
  assert.throws(()=>calculateSequentialEvidence(j),/Contradictory/);
  assert.equal(JSON.stringify(j),before);
});
for(const [key,value] of [['home','BUF'],['away','BAL'],['gameDate','2026-11-09'],['commenceTime','2026-11-08T19:00:00.000Z']])test('Conflicting frozen '+key+' never qualifies',()=>{
  const j=syntheticScoringJournal(30);
  j.snapshots.push({...j.snapshots[0],id:'conflicting',capturedAt:'2026-11-07T12:01:00.000Z',[key]:value});
  withheld(j,29);
});
test('Feed rejects legacy/public summary metric bypasses and retains its safe fallback',async()=>{
  const valid=summary(syntheticScoringJournal(30)),fallback=summary(syntheticScoringJournal(0));
  const legacy={...valid};delete legacy.outcomeScoringPolicy;
  const bypasses=[legacy,{...valid,sourceCorroboratedSettledGames:0},
    {...valid,sourceUncorroboratedSettledGames:1},{...valid,sourceCorroboratedMarketGames:31},
    {...valid,forwardMetrics:{...valid.forwardMetrics,n:31}},
    {...valid,marketComparison:{...valid.marketComparison,n:31}},
    {...valid,challengerForwardComparison:{...valid.challengerForwardComparison,n:31}},
    {...valid,recentResults:[{sourceCorroborated:false,brier:.1}]},
    {...valid,sourceIndependenceVerified:true}];
  for(const payload of bypasses){
    assert.equal(isValidEvidenceSummary(payload),false);
    const feed=createEvidenceFeed({fallback,clock:()=>NOW,fetchImpl:async()=>new Response(JSON.stringify(payload))});
    assert.deepEqual(await feed.get(),fallback);
    assert.equal(feed.status().lastError,'PUBLICATION_UNAVAILABLE_OR_INVALID');
  }
});
test('Checked-in real journal remains unchanged: community scores do not qualify',async()=>{
  const path=new URL('../data/evidence/nfl-2026.json',import.meta.url),before=await readFile(path,'utf8'),j=JSON.parse(before);
  const out=summary(j);
  assert.equal(out.sourceCorroboratedSettledGames,0);
  assert.equal(out.forwardMetrics,null);
  assert.ok(out.recentResults.every(r=>r.brier===null));
  assert.equal(calculateSequentialEvidence(j).eligibleSettledNonTieGames,0);
  assert.equal(summarizeDerivedForwardMarkets(j).sequentialMarketEvidence.eligibleSettledNonTieGames,0);
  assert.equal(await readFile(path,'utf8'),before);
});
for(const revision of [undefined,0,-1,'2',NaN])test('An unordered/malformed correction cannot fall back to an older qualified result: '+String(revision),()=>{
  const j=syntheticScoringJournal(30),correction={...j.settlements[0],revision,finalityAttestation:null};
  for(const records of [[correction,...j.settlements],[...j.settlements,correction]]){
    assert.throws(()=>summary({...j,settlements:records}),/revision/);
    assert.throws(()=>calculateSequentialEvidence({...j,settlements:records}),/revision/);
  }
});
test('A legacy result without a revision remains visible but unqualified on its own',()=>{
  const j=syntheticScoringJournal(1,0);delete j.settlements[0].revision;
  assert.equal(withheld(j).settledGames,1);
});
