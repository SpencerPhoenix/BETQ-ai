#!/usr/bin/env node
/**
 * Frozen P1 study: true positive and false positive rates of BETQ's existing
 * model promotion evidence gate under synthetic signal strengths.
 *
 * Full 2,000 worlds × 7 preregistered cells, each world refits nested
 * prior-only ridge logistic coefficients, scores 2022–2025 and uses 300
 * week-clustered bootstrap draws per world.
 *
 * NO paid API, real sportsbook entries, betting or model promotion.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {indexedHistoricalClosing,replaySeason} from '../src/historical-replay.mjs';
import {rowsFromReplay} from '../src/residual-research.mjs';
import {runPromotionPowerStudy,POWER_PROTOCOL,POWER_CELLS} from '../src/promotion-power.mjs';

const SOURCE='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const destination='data/promotion-power/summary.json';
const response=await fetch(SOURCE,{signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error('Public NFL schedules source unavailable: '+response.status);
const sourceText=await response.text();
if(sourceText.length>12000000)throw Error('Schedules source unexpectedly large');
const sourceSha=createHash('sha256').update(sourceText).digest('hex');
const frozen=JSON.parse(await readFile('data/residual-research/summary.json','utf8'));
if(sourceSha!==frozen.sourceSha256)
  throw Error('Source release revised since prior research: STOP. Need a versioned source reconciliation.');
const previous=await readFile(destination,'utf8').then(JSON.parse).catch(()=>null);
if(previous?.version===POWER_PROTOCOL.version&&previous?.sourceSha256===sourceSha&&
  previous?.worldsPerCell===POWER_PROTOCOL.worldsPerCell&&
  previous?.results?.length===POWER_CELLS.length){
  console.log('Original preregistered power experiment already published for this data revision');
  console.log(JSON.stringify(previous.results.map(x=>({cell:x.id,
    oldGatePass:x.originalStrictGate.passRatePercent,
    simplerPooledPass:x.diagnosticPooledGate.passRatePercent})),null,2));
  process.exit(0);
}
const rows=parseCsv(sourceText);
const games=cleanGames(rows,{today:new Date().toISOString().slice(0,10)});
const prices=indexedHistoricalClosing(rows);
const frames=new Map();
for(let season=2020;season<=2025;season++){
  const replay=replaySeason(games,prices,season,{thresholds:[.03],exampleCount:0});
  const sample=rowsFromReplay(replay);
  if(sample.length<200)throw Error('Missing paired covariate frame for '+season);
  frames.set(season,sample.map(row=>({
    year:row.year,week:row.week,date:row.date,gameId:row.gameId,
    market:row.market
  })));
}
console.log('SYNTHETIC COVARIATE FRAMES: '+[...frames.entries()].map(([y,f])=>y+':'+f.length).join(', '));
console.log('STUDY START: 7 fixed cells × 2000 worlds; original gate with 300 pooled bootstrap draws per world.');
const started=Date.now();
const result=runPromotionPowerStudy(frames,{
  cells:POWER_CELLS,worldsPerCell:POWER_PROTOCOL.worldsPerCell,
  bootstrapDraws:POWER_PROTOCOL.pairedBootstrapDraws,
  seed:POWER_PROTOCOL.seed,
  onCell:cell=>console.log('CELL FINISHED '+cell.id+
    ' original-pass '+cell.originalStrictGate.approved+'/'+cell.worlds+
    ' pooled-logloss-pass '+cell.diagnosticPooledGate.approved+'/'+cell.worlds+
    ' oracle-expected-gain '+cell.meanOracleExpectedLogLossGain+
    ' elapsed-sec '+Math.round((Date.now()-started)/1000))
});
result.generatedAt=new Date().toISOString();
result.sourceSha256=sourceSha;
result.source={
  name:'nflverse / Lee Sharpe',license:'CC BY 4.0',url:SOURCE,
  type:'Historical market/time covariates; all simulated outcomes synthetic'
};
result.sourceResearchVersion=frozen.version;
result.protocolCommit='3fd15fb1bfbf8cf874cb70c96ff088d46ee4ad46';
result.notAValidatedModelOrRealWorldBettingEdge=true;
await mkdir('data/promotion-power',{recursive:true});
await writeFile(destination,JSON.stringify(result,null,2)+'\n','utf8');
for(const cell of result.results){
  console.log('POWER '+cell.id+' strict='+cell.originalStrictGate.passRatePercent+
    '% pooled='+cell.diagnosticPooledGate.passRatePercent+
    '% signal='+cell.signalLogitScale+' rho='+cell.signalObservationCorrelation+
    ' oracleLLGain='+cell.meanOracleExpectedLogLossGain);
}
console.log('POWER STUDY FINISHED '+result.results.length+' cells × '+result.worldsPerCell+
  ' worlds; NO BETTING MODEL PROMOTED OR PROFIT CLAIMED');
