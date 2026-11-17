/** Read-only diagnostics. Team-week presence is not a complete/current roster. */
import {validateInjuryArtifact} from './injury-feed.mjs';
import {injurySourceStatus} from './injuries.mjs';
import {nflGameDate} from './integrity.mjs';
import {NFL_TEAMS} from './nfl-elo.mjs';

export function auditInjuryCoverage(artifact,{now=Date.now()}={}){
  validateInjuryArtifact(artifact,now);
  const source=injurySourceStatus(artifact,now);
  const today=nflGameDate({commence_time:new Date(now).toISOString()});
  const horizon=nflGameDate({commence_time:new Date(now+14*86400000).toISOString()});
  // Date-only candidates are NOT official kickoff verification or pregame eligibility.
  const fixtures=artifact.fixtures.filter(f=>f.gameDate>=today&&f.gameDate<=horizon);
  const games=fixtures.map(f=>{
    const present=[f.away,f.home].filter(t=>Object.hasOwn(artifact.reports,`${t}:${f.week}`));
    return {gameId:f.gameId,week:f.week,gameDate:f.gameDate,
      recordedTeams:present,missingTeams:[f.away,f.home].filter(t=>!present.includes(t)),
      recordedTeamCount:present.length,usableTeamCount:source.available?present.length:0};
  });
  const teams=[...new Set(Object.values(NFL_TEAMS))].sort();
  const weeks=[...new Set(fixtures.map(f=>f.week))].sort((a,b)=>a-b).map(week=>{
    const recordedTeams=teams.filter(t=>Object.hasOwn(artifact.reports,`${t}:${week}`));
    const expectedTeams=[...new Set(fixtures.filter(f=>f.week===week).flatMap(f=>[f.away,f.home]))].sort();
    return {week,recordedTeams,recordedTeamCount:recordedTeams.length,
      candidateTeams:expectedTeams,missingCandidateTeams:expectedTeams.filter(t=>!recordedTeams.includes(t)),
      reason:recordedTeams.length===0?'NO_TEAM_WEEK_RECORDS':null};
  });
  const reasons=[];
  if(!source.available)reasons.push(source.reason);
  if(!games.length)reasons.push('NO_DATE_WINDOW_FIXTURES');
  if(games.some(g=>g.missingTeams.length))reasons.push('MATCHUP_RECORDS_MISSING');
  return {schema:1,auditedAt:new Date(now).toISOString(),season:artifact.season,
    sourceUpdatedAt:artifact.sourceUpdatedAt,builtAt:artifact.builtAt,
    sourceAvailable:source.available,sourceReason:source.reason,
    freshnessBasis:'SOURCE_FILE_ONLY',sourceAgeSeconds:source.sourceAgeSeconds,
    dateWindow:{from:today,to:horizon,timeZone:'America/New_York'},candidateGameCount:games.length,
    gamesWithBothRecords:games.filter(g=>g.recordedTeamCount===2).length,
    gamesWithBothUsableRecords:games.filter(g=>g.usableTeamCount===2).length,
    status:reasons.length?'GAPS_OBSERVED':'RECORD_PRESENCE_ONLY',reasons,weeks,games,
    rosterCompletenessVerified:false,starterVerified:false,probabilitiesAdjusted:false,
    caveat:'Artifact date-window candidates are not verified pregame fixtures. Missing team-week records mean unknown, not healthy. Present records do not establish complete rosters, current individual reports, confirmed starters or injury-adjusted probabilities. No provider was queried.'};
}
