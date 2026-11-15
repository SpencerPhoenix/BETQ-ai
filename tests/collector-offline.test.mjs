import test from 'node:test';
import {describeModelDelivery} from '../src/model-delivery.mjs';
import {syntheticDeliveryArtifact,modelHealthFixture} from './fixtures/model-delivery.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {emptyJournal} from '../src/evidence.mjs';

// Exercise the actual collector entry point with all fetches intercepted.
// No real provider, schedule, credentials or repository evidence is used.
test('A delayed collector response uses receipt-time chronology and deliberate paid intent', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'betq-collector-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = new URL('../scripts/capture-evidence.mjs', import.meta.url).href;
  const modelArtifact=syntheticDeliveryArtifact('2026-11-07T11:00:00.000Z','2026-11-06');
  await mkdir(join(directory,'data'),{recursive:true});await writeFile(join(directory,'data/nfl_elo.json'),JSON.stringify(modelArtifact));
  const identity=describeModelDelivery(modelArtifact,Date.parse('2026-11-07T12:00:00.000Z'));
  const health=modelHealthFixture(modelArtifact,Date.parse('2026-11-07T12:00:00.000Z'));
  const code = `
    let now = Date.parse('2026-11-07T12:00:00.000Z'), calls = 0;
    Date.now = () => now;
    const iso = n => new Date(n).toISOString();
    globalThis.fetch = async (input, options) => {
      const url = String(input); calls++;
      if(url==='https://offline-betq.test/api/health'){
        if(options.headers.Authorization||options.headers['x-betq-paid-request'])throw Error('Credentials leaked to health');
        return Response.json(${JSON.stringify(health)});
      }
      if (url === 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv') {
        return new Response('game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\\n2026_10_LV_KC,2026,REG,2026-11-08,KC,LV,,,Home\\n');
      }
      if (!url.startsWith('https://offline-betq.test/api/slate?')) throw Error('Unexpected fetch');
      if (options.headers['x-betq-paid-request'] !== 'true') throw Error('Missing paid request intent');
      if (options.headers.Authorization !== 'Bearer OFFLINE_OPERATOR_FIXTURE_0123456789') throw Error('Missing operator authentication');
      if (options.redirect !== 'error') throw Error('Unsafe redirect handling');
      now += 90000; // Longer than the one-minute clock-skew allowance.
      return Response.json({
        demo: false, source: 'THE_ODDS_API_V4', sport: 'americanfootball_nfl', market: 'h2h',
        nflModelDelivery:${JSON.stringify(identity)}, receivedAt: iso(now - 1000), events: [{
          id: 'offline-event', homeTeam: 'Kansas City Chiefs', awayTeam: 'Las Vegas Raiders',
          commenceTime: '2026-11-08T18:00:00.000Z',
          independentModel: {
            available: true, method: 'NFL_ELO_HISTORICAL_OUTCOMES', independentOfOdds: true,
            use: 'RESEARCH_ONLY', homeWinProbability: 0.6, modelVersion: 'nfl-elo-1',
            modelBuiltAt: '2026-11-07T11:00:00.000Z', throughGameDate: '2026-11-06',deliveryIdentity:${JSON.stringify(identity)}
          },
          marketConsensus: {
            available: true, method: 'ALL_BOOKS_MEDIAN_DE_VIG', books: 3, homeProbability: 0.55,
            oldestQuoteAgeSeconds: 2, oldestQuoteAt: iso(now - 2000), latestQuoteAt: iso(now - 2000), disagreementPoints: 1
          }
        }]
      });
    };
    await import(${JSON.stringify(entry)});
    if (calls !== 3) throw Error('Unexpected fetch count: ' + calls);
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: directory, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, ODDS_API_KEY: '', BETQ_SHADOW_DATABASE_URL: '',
      BETQ_SHADOW_CAPTURE_ENABLED: 'false', BETQ_PRODUCTION_URL: 'https://offline-betq.test',
      BETQ_OPERATOR_APPROVED_ORIGIN: 'https://offline-betq.test', BETQ_OPERATOR_REFRESH_TOKEN: 'OFFLINE_OPERATOR_FIXTURE_0123456789' }
  });
  assert.match(output, /"captureStatus": "SUCCESS"/);
  assert.match(output, /"appended": 1/);
  const journal = JSON.parse(await readFile(join(directory, 'data/evidence/nfl-2026.json'), 'utf8'));
  assert.equal(journal.snapshots.length, 1);
  assert.equal(journal.snapshots[0].capturedAt, '2026-11-07T12:01:30.000Z');
  assert.equal(journal.settlements.length, 0);
});


test('Missing operator token skips paid capture explicitly and still reconciles public schedules',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'betq-collector-no-token-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const entry=new URL('../scripts/capture-evidence.mjs',import.meta.url).href;
  const code=`
    Date.now=()=>Date.parse('2026-11-07T12:00:00Z');
    let calls=0;
    globalThis.fetch=async input=>{
      if(String(input)!=='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv')throw Error('Unexpected paid fetch');
      calls++;return new Response('game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\\n');
    };
    await import(${JSON.stringify(entry)});
    if(calls!==1)throw Error('Results source was not read');
  `;
  const output=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',timeout:10000,
    env:{...process.env,BETQ_OPERATOR_REFRESH_TOKEN:'',BETQ_CAPTURE_SKIP_REASON:''}});
  assert.match(output, /"captureStatus": "SKIPPED: OPERATOR_TOKEN_MISSING"/);
  assert.match(output, /"appended": 0/);
  assert.match(output, /continuing results reconciliation/);
  const journal=JSON.parse(await readFile(join(directory,'data/evidence/nfl-2026.json'),'utf8'));
  assert.equal(journal.snapshots.length,0);
});

// A real-source-shaped CSV is not proof of a final game, even when scores exist.
test('Actual collector reports missing native finality fields without rewriting retained scores',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'betq-collector-receipts-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const entry=new URL('../scripts/capture-evidence.mjs',import.meta.url).href;
  const j={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance},before=JSON.stringify(j,null,2)+'\n';
  await mkdir(join(directory,'data/evidence'),{recursive:true});
  const path=join(directory,'data/evidence/nfl-2026.json');await writeFile(path,before);
  const csv='game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\nfixture-game-0,2026,REG,2026-11-08,KC,LV,27,17,Home\n';
  const code=`
    Date.now=()=>Date.parse('2026-11-15T12:00:00.000Z');let calls=0;
    globalThis.fetch=async input=>{
      if(String(input)!=='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv')throw Error('Unexpected request');
      calls++;return new Response(${JSON.stringify(csv)});
    };
    await import(${JSON.stringify(entry)});
    if(calls!==1)throw Error('Unexpected request count');
  `;
  const output=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',timeout:10000,
    env:{...process.env,BETQ_OPERATOR_REFRESH_TOKEN:'',BETQ_CAPTURE_SKIP_REASON:''}});
  assert.match(output,/"sourceReceiptStructurallyValid": true/);
  assert.match(output,/"MISSING_EXPLICIT_FINAL_STATUS": 1/);
  assert.match(output,/"MISSING_CANONICAL_SOURCE_KICKOFF": 1/);
  assert.match(output,/"admissibleResultCandidates": 0/);
  assert.match(output,/"newResultsOrCorrections": 0/);
  assert.match(output,/"scoringQualification": "NOT_SUPPLIED_BY_SCHEDULE_SOURCE"/);
  assert.equal(await readFile(path,'utf8'),before);
});
