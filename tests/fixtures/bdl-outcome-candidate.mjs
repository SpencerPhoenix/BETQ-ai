// Fabricated fixtures only. No actual provider response or research outcome.
import {syntheticScoringJournal} from './source-corroborated.mjs';
export function syntheticBdlOutcomeInput(){
  const journal=syntheticScoringJournal(1,0);journal.settlements=[];
  journal.provenance={synthetic:true,description:'OFFLINE_BDL_POLICY_FIXTURE_ONLY'};
  journal.snapshots[0].gameId='2026_10_LV_KC';
  const event={id:9999001,home_team:{id:99901,abbreviation:'KC'},visitor_team:{id:99902,abbreviation:'LV'},
    season:2026,postseason:false,date:'2026-11-08T18:00:00.000Z',status_state:'final',status:'Final',
    updated_at:'2026-11-08T22:00:00.000Z',home_team_score:27,visitor_team_score:17};
  const csv='game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\n2026_10_LV_KC,2026,REG,2026-11-08,KC,LV,27,17,Home\n';
  return {journal,gameId:'2026_10_LV_KC',expectedProviderGameId:9999001,
    bdlBytes:new TextEncoder().encode(JSON.stringify({data:event})),nflverseBytes:new TextEncoder().encode(csv),
    bdlRetrievedAt:'2026-11-09T18:01:00.000Z',nflverseRetrievedAt:'2026-11-09T18:02:00.000Z',
    evaluatedAt:'2026-11-09T18:03:00.000Z'};
}
export function mutateSyntheticBdl(input,change){
  const payload=JSON.parse(new TextDecoder().decode(input.bdlBytes));change(payload.data,payload);
  input.bdlBytes=new TextEncoder().encode(JSON.stringify(payload));return input;
}
export function mutateSyntheticSchedule(input,change){
  input.nflverseBytes=new TextEncoder().encode(change(new TextDecoder().decode(input.nflverseBytes)));return input;
}
