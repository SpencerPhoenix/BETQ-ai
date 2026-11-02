#!/usr/bin/env node
/**
 * Reproducible, no-credentials NFL efficiency challenger. Downloads nflverse's
 * own season PBP CSV.gz releases and only commits compact derived model stats.
 * Full unmodified PBP is never stored in BETQ's public repository.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseCsv, cleanGames } from '../src/nfl-elo.mjs';
import { downloadPbpSeason } from '../src/pbp.mjs';
import { fitEfficiencyChallenger } from '../src/nfl-efficiency.mjs';

const SCHEDULE_URL='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const ELO_ARTIFACT='data/nfl_elo.json';
const TARGET='data/nfl_efficiency.json';
const YEAR=Number(process.env.EFFICIENCY_END_SEASON || 2026);
if(!Number.isInteger(YEAR)||YEAR<2025||YEAR>2100)throw Error('Invalid latest NFL season');

const response=await fetch(SCHEDULE_URL,{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('nflverse schedule source failed HTTP '+response.status);
const raw=await response.text();
if(raw.length>12000000)throw Error('Schedules exceed limit');
const games=cleanGames(parseCsv(raw),{today:new Date().toISOString().slice(0,10)})
  .filter(g=>g.season>=2018&&g.season<=YEAR);
const elo=JSON.parse(await readFile(ELO_ARTIFACT,'utf8'));
if(!elo?.readyForResearch||!elo?.params||elo?.source?.project!=='nflverse/nflverse-data')
  throw Error('Frozen Elo baseline or source provenance unavailable');
if(games.filter(x=>x.season===2025).length<260)throw Error('2025 season incomplete');

const allPbp={};let completeGames=0,acceptedPlays=0;
const manifests=[];
for(let season=2018;season<=YEAR;season++){
  const subset=games.filter(g=>g.season===season);
  if(!subset.length)continue;
  const part=await downloadPbpSeason(season,subset,{log:console.log});
  Object.assign(allPbp,part.games);
  completeGames+=part.report.completeGames;acceptedPlays+=part.report.acceptedPlays;
  manifests.push({season,source:part.source,completeGames:part.report.completeGames,
    parsedBytes:part.report.bytes});
}
const latestWithPbp=games.filter(g=>allPbp[g.id]).at(-1);
if(!latestWithPbp||completeGames<1800||acceptedPlays<120000)
  throw Error('Insufficient complete PBP games or offensive plays');
if(YEAR===2026&&games.filter(g=>g.season===2026&&allPbp[g.id]).length<90)
  throw Error('2026 play-by-play feed not sufficiently up to date');

const artifact=fitEfficiencyChallenger(games,allPbp,elo.params,{asOf:new Date().toISOString()});
artifact.sourceManifest={
  project:'nflverse/nflverse-data',
  attribution:'nflverse / nflfastR; CC BY 4.0',
  license:'CC BY 4.0',
  scheduleUrl:SCHEDULE_URL,
  pbpReleases:manifests,
  sourceLastCompletedGame:latestWithPbp.date,
  playedGamesWithPbp:completeGames,
  qualifyingPlays:acceptedPlays
};
artifact.eloBaselineVersion=elo.version;
artifact.dataFingerprint=createHash('sha256').update(
  JSON.stringify([elo.completedGamesSha256,manifests.map(x=>[x.season,x.completeGames]),
    games.map(g=>[g.id,g.homeScore,g.awayScore]),
    Object.entries(allPbp).sort(([a],[b])=>a.localeCompare(b))])
).digest('hex');
const prior=await readFile(TARGET,'utf8').then(JSON.parse).catch(()=>null);
if(prior?.dataFingerprint===artifact.dataFingerprint&&prior?.version===artifact.version){
  console.log('No new completed data: existing challenger unchanged');
  console.log(JSON.stringify({promotable:prior.promotable,holdout:prior.holdout},null,2));
  process.exit(0);
}
await mkdir(dirname(TARGET),{recursive:true});
await writeFile(TARGET,JSON.stringify(artifact,null,2)+'\n','utf8');
console.log(JSON.stringify({
  version:artifact.version,completeGames,acceptedPlays,
  sourceLastCompletedGame:latestWithPbp.date,
  featureReadyGames:artifact.coverage.featureReadyGames,
  tuning:artifact.tuning,calibration:artifact.calibration,
  holdout:artifact.holdout,promotable:artifact.promotable,
  note:'Research challenger. No autonomous promotion or betting execution.'
},null,2));
