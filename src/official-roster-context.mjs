/** Manually source-reviewed club articles: contextual only, never model features. */
import {readFileSync} from 'node:fs';
const allowed=[
 'https://www.baltimoreravens.com/news/game-preview-jacoby-brissett-ravens-first-start-week-10-against-chargers-monday-night-football',
 'https://www.baltimoreravens.com/news/lamar-jackson-tyler-huntley-injured-reserve-austin-reed-adisa-isaac-jake-moody'
];
let bundled=null;
try{bundled=JSON.parse(readFileSync(new URL('../data/official_roster_context.json',import.meta.url),'utf8'));}catch{}
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
export function officialRosterContext({artifact=bundled,now=Date.now()}={}){
 const a=artifact;
 if(!Number.isFinite(now)||a?.schema!==1||a.gameId!=='2026_10_LAC_BAL'||a.home!=='BAL'||a.away!=='LAC'||
    a.kickoff!=='2026-11-17T01:15:00.000Z'||!iso(a.observedAt)||Date.parse(a.observedAt)>=Date.parse(a.kickoff)||
    a.expectedQuarterback!=='Jacoby Brissett'||JSON.stringify(a.injuredReserve)!==JSON.stringify(['Lamar Jackson','Tyler Huntley'])||
    !Array.isArray(a.sources)||a.sources.length!==2||!a.sources.every((s,i)=>s.url===allowed[i]&&iso(s.publishedAt)&&
      Date.parse(s.publishedAt)<=Date.parse(a.observedAt)&&/^[a-f0-9]{64}$/.test(s.bodySha256)&&typeof s.title==='string'&&s.title.length<100))return [];
 const validUntil=new Date(Math.min(Date.parse(a.kickoff),Date.parse(a.observedAt)+6*3600000)).toISOString();
 const reason=now<Date.parse(a.observedAt)?'OBSERVATION_IN_FUTURE':now>=Date.parse(validUntil)?'OBSERVATION_EXPIRED':null;
 return [{gameId:a.gameId,home:a.home,away:a.away,available:reason===null,reason,observedAt:a.observedAt,validUntil,
   sources:structuredClone(a.sources),expectedQuarterback:reason?null:a.expectedQuarterback,injuredReserve:reason?[]:[...a.injuredReserve],
   scope:'MANUALLY_REVIEWED_BAL_QB_ARTICLES_PILOT',starterVerified:false,probabilitiesAdjusted:false,automaticallyRefreshed:false}];
}
