#!/usr/bin/env node
/** Explicit single public GET. No automatic schedule, credentials or paid API. */
import {readBoundedText} from '../src/integrity.mjs';
import {officialWeeklyUrl,parseOfficialWeeklyPage} from '../src/nfl-official-finality.mjs';
const [seasonText,weekText,...extra]=process.argv.slice(2);
if(extra.length||!seasonText||!weekText)throw Error('Usage: season week');
const season=Number(seasonText),week=Number(weekText),sourceUrl=officialWeeklyUrl(season,week);
const response=await fetch(sourceUrl,{credentials:'omit',redirect:'error',headers:{Accept:'text/html'},signal:AbortSignal.timeout(30000)});
if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('OFFICIAL_PAGE_UNAVAILABLE');
const html=await readBoundedText(response,8000000),observedAt=new Date().toISOString();
console.log(JSON.stringify([parseOfficialWeeklyPage(html,{season,week,sourceUrl,observedAt})],null,2));
