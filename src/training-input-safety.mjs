/** Conservative schedule-input hygiene, NOT an independent final-status receipt. */
import { cleanGames } from './nfl-elo.mjs';
export const TRAINING_INPUT_POLICY = 'NFL_SCHEDULE_DELAYED_RESULTS_V1';
const DAY=86400000;
const FINAL=new Set(['FINAL','COMPLETED','STATUS_FINAL']);
export function selectTrainingGames(rows,{asOf=new Date().toISOString()}={}) {
  const now=Date.parse(asOf);
  if(!Number.isFinite(now)||!Array.isArray(rows))throw Error('Invalid training input/as-of');
  const rejected={recentOrFuture:0,explicitNonfinal:0,venueUnknown:0,conflictingDuplicate:0,invalid:0};
  // An immutable first payload must not win over a conflicting later duplicate.
  const signatures=new Map(),conflicts=new Set();
  for(const row of rows){
    if(!row?.game_id)continue;
    const sig=JSON.stringify([row.gameday,row.home_team,row.away_team,row.home_score,row.away_score,row.location,row.status,row.game_status]);
    if(signatures.has(row.game_id)&&signatures.get(row.game_id)!==sig)conflicts.add(row.game_id);
    signatures.set(row.game_id,sig);
  }
  const accepted=[];
  for(const row of rows){
    if(conflicts.has(row?.game_id)){rejected.conflictingDuplicate++;continue;}
    // Do not interpret nonblank partial scores as final. Explicit unknown,
    // scheduled, postponed, suspended or in-progress status fails closed.
    const statuses=[row?.status,row?.game_status].filter(x=>x!==undefined&&x!==null&&String(x).trim()!=='');
    if(statuses.some(s=>!FINAL.has(String(s).trim().toUpperCase()))){rejected.explicitNonfinal++;continue;}
    // Schedules have date precision, not trustworthy completion timestamps.
    // Wait 12h beyond the whole UTC game day even when a final flag is present.
    const end=Date.parse(`${row?.gameday}T00:00:00Z`)+DAY;
    if(!Number.isFinite(end)||end+12*3600000>now){rejected.recentOrFuture++;continue;}
    if(!['Home','Neutral'].includes(row?.location)){rejected.venueUnknown++;continue;}
    if(!cleanGames([row]).length){rejected.invalid++;continue;}
    accepted.push(row);
  }
  const games=cleanGames(accepted);
  const latestSeason=games.length?Math.max(...games.map(g=>g.season)):null;
  const teams={};
  for(const game of games.filter(g=>g.season===latestSeason))for(const team of [game.home,game.away]){
    teams[team]??={games:0,lastGameDate:null};teams[team].games++;teams[team].lastGameDate=game.date;
  }
  return {games,report:{policy:TRAINING_INPUT_POLICY,asOf:new Date(now).toISOString(),
    minimumHoursAfterUtcGameDay:12,acceptedGames:games.length,rejected,
    independentlyVerifiedFinality:false,completeScheduleCoverageVerified:false,
    latestSeason,teams,limitations:[
      'Score presence plus an age embargo is not independent proof of a final result.',
      'Per-team counts describe accepted source rows, not reconciliation against every scheduled game.',
      'Unknown venues, explicit nonfinal states and conflicting duplicate IDs are excluded.'
    ]}};
}
