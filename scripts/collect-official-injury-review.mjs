#!/usr/bin/env node
/** Explicit one-shot public club-page observation. No schedule or paid provider. */
import {readFile,writeFile} from 'node:fs/promises';
import {readBoundedText} from '../src/integrity.mjs';
import {OFFICIAL_INJURY_URL,createOfficialInjuryReceipt} from '../src/official-injury-review.mjs';
const gameId=process.argv[2];
if(process.argv.length!==3||!/^20\d{2}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(gameId||''))throw Error('Provide explicit retained game ID');
const journal=JSON.parse(await readFile('data/evidence/nfl-2026.json','utf8'));
const rows=journal.snapshots.filter(s=>s.gameId===gameId);
const times=new Set(rows.map(s=>s.commenceTime));
if(!rows.length||times.size!==1||!Number.isFinite(Date.parse(rows[0].commenceTime))||Date.parse(rows[0].commenceTime)<=Date.now())throw Error('Unanimous future retained kickoff required');
const [season,week,away,home]=gameId.split('_');
if(![home,away].includes('LAC')||rows.some(s=>s.home!==home||s.away!==away||s.season!==Number(season)))throw Error('Unsupported official club fixture');
const response=await fetch(OFFICIAL_INJURY_URL,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30000),headers:{Accept:'text/html'}});
if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('Official page unavailable');
const html=await readBoundedText(response,1000000);
const receipt=createOfficialInjuryReceipt(html,{gameId,season:Number(season),week:Number(week),home,away,kickoff:rows[0].commenceTime,observedAt:new Date().toISOString()});
const path='data/official_injury_reviews.json';
const artifact=await readFile(path,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {schema:1,receipts:[]};throw e;});
if(artifact.schema!==1||!Array.isArray(artifact.receipts)||artifact.receipts.length>=64)throw Error('Receipt ledger invalid or full');
artifact.receipts.push(receipt);
await writeFile(path,JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify({gameId,sourceUrl:receipt.sourceUrl,observedAt:receipt.observedAt,sourcePublishedAt:null,teams:Object.fromEntries(Object.entries(receipt.reports).map(([k,v])=>[k,v.length])),probabilitiesAdjusted:false}));
