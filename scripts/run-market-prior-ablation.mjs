#!/usr/bin/env node
/** Explicit local input and NEW output directory only. No fetch, secrets or production writes. */
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {indexedHistoricalClosing,replaySeason,fitBeforeSeason,walkForwardByDay} from '../src/historical-replay.mjs';
import {rowsFromReplay} from '../src/residual-research.mjs';
import {fitBeforeTarget,predictModels,runMarketPriorAblation} from '../src/market-prior-ablation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [inputArg,outArg,...extra]=process.argv.slice(2);
if(!inputArg||!outArg||extra.length)throw Error('Usage: node scripts/run-market-prior-ablation.mjs LOCAL_GAMES_CSV NEW_OUTPUT_DIRECTORY');
const root=await realpath(new URL('..',import.meta.url)),input=await realpath(resolve(inputArg));
const out=resolve(outArg),outParent=await realpath(resolve(out,'..'));
const relativeParent=relative(root,outParent);
if(!(relativeParent==='..'||relativeParent.startsWith('../')))throw Error('Research outputs must be outside the repository');
const protocolBytes=await readFile(new URL('../docs/MARKET_PRIOR_ABLATION_PROTOCOL_2026_11_20.json',import.meta.url));
const protocol=JSON.parse(protocolBytes),bytes=await readFile(input);
if(sha(bytes)!==protocol.sourceSha256)throw Error('RETAINED_SOURCE_HASH_MISMATCH');
await mkdir(out,{recursive:false}); // Refuse accidental overwrite of an earlier attempt.
await writeFile(resolve(out,'protocol.json'),protocolBytes,{flag:'wx'});
const sourceRows=parseCsv(bytes.toString()),games=cleanGames(sourceRows,{today:protocol.sourceDateCeiling}).filter(g=>g.season<=2025)
 .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
const prices=indexedHistoricalClosing(sourceRows),replays=[],rows=[],excluded=[];
for(const year of protocol.replaySeasons){
 const replay=replaySeason(games,prices,year,{thresholds:[],exampleCount:0});
 replays.push({season:year,fit:replay.fit});const r=rowsFromReplay(replay);rows.push(...r);
 const included=new Set(r.map(x=>x.gameId));
 for(const d of replay.decisions)if(!included.has(d.gameId))excluded.push({gameId:d.gameId,season:year,reason:d.actual==='TIE'?'BINARY_TARGET_TIE':!d.priceAvailable?'NO_VALID_PAIRED_MARKET':'INVALID_REPLAY_ROW'});
 console.log('Reconstructed '+year+': '+r.length+' paired non-ties');
}
const result=runMarketPriorAblation(rows,{resamples:protocol.bootstrapResamples,seed:protocol.seed});
const checks=[];
for(const year of protocol.evaluationSeasons){
 const altered=games.map(g=>g.season>=year?{...g,homeScore:3,awayScore:99}:g);
 const original=replays.find(r=>r.season===year).fit;
 assert.deepEqual(fitBeforeSeason(altered,year),original);
 const openingDay=games.find(g=>g.season===year).date;
 const first=x=>walkForwardByDay(x.filter(g=>g.date<=openingDay),original.params).history.filter(r=>r.date===openingDay).map(r=>[r.id,r.prediction]);
 assert.deepEqual(first(games),first(altered));
 const alteredRows=rows.map(r=>r.year>=year?{...r,actual:1-r.actual}:r);
 const fit=fitBeforeTarget(rows,year),alteredFit=fitBeforeTarget(alteredRows,year);assert.deepEqual(fit,alteredFit);
 for(const r of rows.filter(r=>r.year===year))assert.deepEqual(predictModels(r,fit),predictModels({...r,actual:1-r.actual},alteredFit));
 checks.push({year,priorOnlyEloFit:true,openingDayFutureScoreInvariant:true,priorOnlyMarketFits:true,currentOutcomePredictionInvariant:true});
}
const codePaths=['src/market-prior-ablation.mjs','scripts/run-market-prior-ablation.mjs','src/residual-research.mjs','src/historical-replay.mjs','src/nfl-elo.mjs'];
const codeSha256=Object.fromEntries(await Promise.all(codePaths.map(async p=>[p,sha(await readFile(resolve(root,p)))])));
const report={protocol,protocolSha256:sha(protocolBytes),sourceSha256:sha(bytes),codeSha256,replays,excluded,integrityChecks:checks,...result.summary};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(out,'predictions.json'),JSON.stringify(result.predictions,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(out,'fits.json'),JSON.stringify(result.fits,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(out,'reconstructed-rows.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({models:report.models,uncertainty:report.uncertainty,integrityChecks:checks},null,2));
