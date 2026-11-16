import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {officialRosterContext} from '../src/official-roster-context.mjs';
const artifact=JSON.parse(readFileSync(new URL('../data/official_roster_context.json',import.meta.url)));
const now=Date.parse(artifact.observedAt);
test('Reviewed official QB articles expose source dates, provenance and model limitation without starter certification',()=>{
 const before=JSON.stringify(artifact),[r]=officialRosterContext({artifact,now});
 assert.equal(r.available,true);assert.equal(r.expectedQuarterback,'Jacoby Brissett');assert.deepEqual(r.injuredReserve,['Lamar Jackson','Tyler Huntley']);
 assert.equal(r.starterVerified,false);assert.equal(r.probabilitiesAdjusted,false);assert.equal(r.automaticallyRefreshed,false);
 assert.equal(r.sources[0].publishedAt,'2026-11-16T16:00:52.099Z');assert.equal(r.sources[1].publishedAt,'2026-11-05T21:35:01.234Z');
 assert.equal(r.validUntil,artifact.kickoff);r.sources[0].title='changed';assert.equal(JSON.stringify(artifact),before);
});
test('QB article context withholds current claims before observation and at kickoff',()=>{
 for(const at of [now-1,Date.parse(artifact.kickoff),Date.parse(artifact.kickoff)+86400000]){
  const [r]=officialRosterContext({artifact,now:at});assert.equal(r.available,false);assert.equal(r.expectedQuarterback,null);assert.deepEqual(r.injuredReserve,[]);
 }
 assert.deepEqual(officialRosterContext({now:NaN}),[]);
});
test('QB context rejects wrong game, foreign source, missing provenance and published-after-observed dates',()=>{
 for(const f of [a=>a.gameId='2026_11_LAC_BAL',a=>a.home='LAC',a=>a.sources[0].url='https://example.com',a=>a.sources[0].bodySha256='',a=>a.sources[0].publishedAt='2026-11-17T16:00:00.000Z',a=>a.observedAt=a.kickoff,a=>a.expectedQuarterback='Someone else']){
  const a=structuredClone(artifact);f(a);assert.deepEqual(officialRosterContext({artifact:a,now}),[]);
 }
});
