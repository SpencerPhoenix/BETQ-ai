import test from 'node:test';
import assert from 'node:assert/strict';
import {auditModelWindow} from '../scripts/audit-model-only-window.mjs';
import {emptyModelLedger,ledgerEvent} from '../src/scheduled-model-ledger.mjs';
const gameId='2026_12_GB_LA',kickoff='2026-11-26T01:00:00.000Z',start='2026-11-25T22:43:31Z';
const old=()=>({id:33,event:'schedule',created_at:start,run_started_at:start});
const sample=(observedAt,workflow_runs=[old()])=>{
 const ledger=emptyModelLedger(Date.parse('2026-11-17T00:00:00.000Z'));
 ledgerEvent(ledger,'RUN',null,{runKey:'33.1',failedWeeks:[],productionCompatible:false,
  productionHealth:{reason:'RUNTIME_MODEL_ARTIFACT_MISMATCH'}},Date.parse(start)+1000);
 return auditModelWindow({ledger,actions:{workflow_runs},gameId,kickoff,observedAt});
};
test('fixture cutoff crosses UTC midnight, and no early miss at inclusive boundary',()=>{
 assert.equal(sample('2026-11-25T23:29:59.999Z').status,'NOT_DUE');
 assert.equal(sample('2026-11-25T23:30:00.000Z').status,'NO_FIXTURE_RECORD_YET');
 assert.equal(sample('2026-11-26T00:15:00.000Z').status,'NO_FIXTURE_RECORD_YET');
 const late=sample('2026-11-26T00:15:00.001Z');
 assert.equal(late.status,'NO_ARCHIVE');assert.equal(late.fixtureFailureCause,null);
 assert.deepEqual(late.runCreated,[]);assert.equal(late.inWindowDurableHeartbeats,0);
});
test('run creation and start are separate; an in-window run does not prove fixture coverage',()=>{
 const queued={id:34,event:'schedule',created_at:'2026-11-25T23:37:00Z',run_started_at:'2026-11-26T00:18:00Z'};
 const report=sample('2026-11-26T00:20:00.000Z',[old(),queued]);
 assert.deepEqual(report.runCreated,[34]);assert.deepEqual(report.runStarted,[]);
 assert.equal(report.status,'NO_ARCHIVE');assert.equal(report.fixtureFailureCause,null);
});
