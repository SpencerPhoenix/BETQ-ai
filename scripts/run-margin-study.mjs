#!/usr/bin/env node
/**
 * Frozen P2 experiment: Elo residual versus retrospective closing NFL spread.
 * No paid odds access, no market signal or execution authorization.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {indexedHistoricalClosing,replaySeason} from '../src/historical-replay.mjs';
import {buildMarginRows,evaluateMarginResearch} from '../src/margin-research.mjs';

const SOURCE='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const reportFile='data/margin-research/summary.json';
const res=await fetch(SOURCE,{signal:AbortSignal.timeout(45000)});
if(!res.ok)throw Error('Cannot fetch public nflverse games CSV: '+res.status);
const sourceText=await res.text();
if(sourceText.length>12000000)throw Error('Unexpected NFL source size');
const sourceSha=createHash('sha256').update(sourceText).digest('hex');
const frozen=JSON.parse(await readFile('data/residual-research/summary.json','utf8'));
if(sourceSha!==frozen.sourceSha256)
  throw Error('Current nflverse source differs from frozen residual benchmark: STOP, do not mix revisions.');
const previous=await readFile(reportFile,'utf8').then(JSON.parse).catch(()=>null);
if(previous?.sourceSha256===sourceSha && previous?.version==='betq-margin-research-v1'){
  console.log('Frozen margin research already exists for this source SHA');
  console.log(JSON.stringify(previous.pooled,null,2));process.exit(0);
}
const rows=parseCsv(sourceText);
const games=cleanGames(rows,{today:new Date().toISOString().slice(0,10)});
const prices=indexedHistoricalClosing(rows);
const replays=[];
for(let year=2020;year<=2025;year++)
  replays.push(replaySeason(games,prices,year,{thresholds:[.03],exampleCount:0}));
const frames=buildMarginRows(rows,replays);
const data=evaluateMarginResearch(frames);
data.sourceSha256=sourceSha;
data.generatedAt=new Date().toISOString();
data.source={url:SOURCE,author:'nflverse / Lee Sharpe',license:'CC BY 4.0',
  description:'Completed game scores + historic closing spreads and moneylines, NOT point-in-time offer prices'};
data.protocol='docs/RESEARCH_PROTOCOL_POWER_MARGIN_2026_11_02.md';
data.protocolCommit='3fd15fb1bfbf8cf874cb70c96ff088d46ee4ad46';
data.futureApplicationRequiresNewProspectiveTest=true;
await mkdir('data/margin-research',{recursive:true});
await writeFile(reportFile,JSON.stringify(data,null,2)+'\n','utf8');
console.log('PRE-2022 SIGN VALIDATION '+JSON.stringify(data.sourceSignValidation));
for(const y of data.years)console.log(
  'MARGIN '+y.season+' n='+y.n+
  ' baselineMSE='+y.closingSpreadBaseline.mse+
  ' correctedMSE='+y.eloMarginResidual.mse+
  ' gain='+y.improvementMse+
  ' beta='+y.coefficients.residualWeight+
  ' lowerCI='+y.paired95.lower95
);
console.log('POOLED MARGIN '+JSON.stringify(data.pooled));
console.log('HISTORICAL EXPLORATORY FLAG '+data.exploratoryEvidenceFlag+
  '; REAL BETTING AUTHORIZED FALSE; VERIFIED ROI/CLV UNAVAILABLE');
