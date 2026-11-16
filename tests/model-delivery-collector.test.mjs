import {describeMarketCaptureContract} from '../src/evidence-compat.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {describeModelDelivery} from '../src/model-delivery.mjs';
import {syntheticDeliveryArtifact,modelHealthFixture} from './fixtures/model-delivery.mjs';
const NOW=Date.parse('2026-11-07T12:00:00.000Z');
const artifact=syntheticDeliveryArtifact('2026-11-07T11:00:00.000Z','2026-11-06');
const health=modelHealthFixture(artifact,NOW),identity=describeModelDelivery(artifact,NOW);
const baseSlate={marketCaptureContract:describeMarketCaptureContract(),demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',market:'h2h',receivedAt:new Date(NOW).toISOString(),nflModelDelivery:identity,events:[]};
async function run(t,{expected=artifact,reported=health,response=baseSlate,healthStatus=200,expectedPaid=0,expectedHealth=1,origin='https://offline-betq.test',oversized=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'betq-model-collector-'));t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(join(directory,'data'),{recursive:true});
 if(expected!==null)await writeFile(join(directory,'data/nfl_elo.json'),JSON.stringify(expected));
 const entry=new URL('../scripts/capture-evidence.mjs',import.meta.url).href;
 const code=`Date.now=()=>${NOW};let paid=0,health=0,csv=0;
 globalThis.fetch=async(input,options)=>{
 const u=String(input);
 if(u==='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'){csv++;return new Response('game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\\n');}
 if(u==='https://offline-betq.test/api/health'){
   health++;if(options.headers.Authorization||options.headers.authorization||options.headers['x-betq-paid-request']||options.redirect!=='error'||options.credentials!=='omit'||options.cache!=='no-store')throw Error('Unsafe health request');
   return ${oversized?"new Response(' '.repeat(33000))":`Response.json(${JSON.stringify(reported)},{status:${healthStatus}})`};
 }
 if(!u.startsWith('https://offline-betq.test/api/slate?'))throw Error('Unexpected origin or endpoint');
 paid++;if(options.headers['x-betq-expected-market-contract']!==${JSON.stringify(describeMarketCaptureContract().contractId)}||options.headers['x-betq-expected-market-policy']!==${JSON.stringify(describeMarketCaptureContract().policy)}||options.headers['x-betq-expected-model-sha256']!=='${identity.artifactCanonicalSha256}'||options.headers['x-betq-paid-request']!=='true'||options.headers.Authorization!=='Bearer OFFLINE_OPERATOR_FIXTURE_0123456789'||options.redirect!=='error')throw Error('Unsafe paid request');
 return Response.json(${JSON.stringify(response)});
 };await import(${JSON.stringify(entry)});
 if(paid!==${expectedPaid}||health!==${expectedHealth}||csv!==1)throw Error('Unexpected fetch counts '+JSON.stringify({paid,health,csv}));`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',timeout:10000,
 env:{PATH:process.env.PATH,BETQ_PRODUCTION_URL:origin,BETQ_OPERATOR_APPROVED_ORIGIN:'https://offline-betq.test',BETQ_OPERATOR_REFRESH_TOKEN:'OFFLINE_OPERATOR_FIXTURE_0123456789'}});
 const journal=JSON.parse(await readFile(join(directory,'data/evidence/nfl-2026.json'),'utf8'));assert.equal(journal.snapshots.length,0);assert.equal(journal.settlements.length,0);return output;
}
for(const [name,reported] of [
 ['missing identity',{...health,nflModel:{available:true}}],
 ['different current artifact',{...health,nflModel:{...health.nflModel,deliveryIdentity:{...identity,artifactCanonicalSha256:'a'.repeat(64)}}}],
 ['stale health',{...health,serverTime:'2026-11-07T11:58:59.999Z'}],
 ['future health',{...health,serverTime:'2026-11-07T12:00:00.001Z'}],
 ['unready budget',{...health,captureReadiness:{ready:false}}],
 ['incompatible runtime',{...health,app:'wrong'}]
])test('Actual collector prevents paid fetch: '+name,async t=>{assert.match(await run(t,{reported}),/"captureStatus": "SKIPPED:/);});
test('Missing checked-out artifact prevents even model health fetch',async t=>{assert.match(await run(t,{expected:null,expectedHealth:0}),/"captureStatus": "SKIPPED:/);});
test('Unapproved origin prevents even model health fetch or credential transmission',async t=>{assert.match(await run(t,{origin:'https://unapproved.test',expectedHealth:0}),/OPERATOR_ORIGIN_NOT_APPROVED/);});
test('HTTP failure and oversized health never allow paid fetch',async t=>{for(const options of [{healthStatus:503},{oversized:true}])assert.match(await run(t,options),/"captureStatus": "SKIPPED:/);});
test('Compatible same-artifact response makes at most one paid fetch, preserving no-retry policy',async t=>{assert.match(await run(t,{expectedPaid:1}),/STARVED: NO_ELIGIBLE_FRESH_CAPTURES/);});
test('Rollback/foreign receiver that ignores expected hash is rejected after sole response, never retried',async t=>{
 const changed=structuredClone(baseSlate);delete changed.nflModelDelivery;
 assert.match(await run(t,{response:changed,expectedPaid:1}),/RUNTIME_MODEL_DELIVERY_UNAVAILABLE/);
 const race=structuredClone(baseSlate);race.nflModelDelivery.artifactCanonicalSha256='a'.repeat(64);
 assert.match(await run(t,{response:race,expectedPaid:1}),/RUNTIME_MODEL_ARTIFACT_MISMATCH/);
});

for(const variant of ['missing','different book identity','backfill allowed'])test('Response capability race fails after one mocked refresh without retries: '+variant,async t=>{
 const response=structuredClone(baseSlate);
 if(variant==='missing')delete response.marketCaptureContract;
 if(variant==='different book identity')response.marketCaptureContract.bookmakerIdentityPolicy='LAST_BOOKMAKER_WINS';
 if(variant==='backfill allowed')response.marketCaptureContract.historicalBackfillAllowed=true;
 assert.match(await run(t,{response,expectedPaid:1}),/RUNTIME_MARKET_CAPTURE_CONTRACT_MISMATCH/);
});
