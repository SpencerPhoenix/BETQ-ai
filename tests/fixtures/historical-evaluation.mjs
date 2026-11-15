/** Fabricated deterministic records; never a source of real research evidence. */
import {FROZEN_FILES} from '../../src/historical-evaluation.mjs';
export function historicalFixture(){
  const neighbors=Array.from({length:50},(_,i)=>({gameId:'2024_'+String(i+1).padStart(2,'0')+'_AA_HA',homeMargin:i===0?3:7,recordedSpread:3,
    homeCover:i===0?null:true,push:i===0,totalLine:44,squaredStandardizedDistance:i/10,features:{epaDiff:.1,successDiff:.02,restDiff:1}}));
  const side={currentGameStarterVerified:false,currentGameQBAvailability:'UNKNOWN',priorGames:1,latestIncludedGameDate:'2024-12-01',includedGameIds:['2024_01_AA_HA']};
  const games=Array.from({length:285},(_,i)=>{
    const home='H'+String.fromCharCode(65+i%16),away='A'+String.fromCharCode(65+i%16),week=Math.floor(i/16)+1;
    return {gameId:'2025_'+String(week).padStart(2,'0')+'_'+away+'_'+home,gameDate:new Date(Date.UTC(2025,8,1+Math.floor(i/16))).toISOString().slice(0,10),
      season:2025,week,gameType:i<272?'REG':'WC',home,away,decisionTimeInputAvailabilityVerified:false,
      labels:{homeScore:24,awayScore:17,homeMargin:7,homeCover:false,spreadPush:false},
      marketReference:{homeExpectedMargin:8,decisionTimeQuoteVerified:false,bookmakerIdentityVerified:false},
      models:Object.fromEntries(['market','marketPlusEfficiency','independentEfficiency'].map((key,j)=>[key,{pointForecastHomeMargin:8+j,losses:{absoluteMargin:1+j,squaredMargin:(1+j)**2}}])),
      features:{epaDiff:.1,successDiff:.02,restDiff:1,home:structuredClone(side),away:structuredClone(side)},
      analogs:{available:true,neighbors:structuredClone(neighbors),meaning:'DESCRIPTIVE_PAST_SIMILARITY_NOT_VALIDATED_PREDICTIVE_PROBABILITY',counts:{HOME_COVER:49,PUSH:1},homeCoverRateGivenNoPush:1}};
  });
  return {artifact:{schema:1,protocol:{id:'BETQ_FIXED_LAGGED_EFFICIENCY_SPREAD_SCREEN_V1',evaluationSeason:2025,fitSeason:2023,residualCalibrationSeason:2024,
    datasetSha256:FROZEN_FILES['lagged-efficiency-2023-2024-2025.json'],recordedAt:'2026-11-05T00:00:00Z',fit:'Fixed test method',similarity:'Fixed test similarity',status:'Fabricated fixture'},
    gameBreakdowns:games,summary:{market:{mae:1,rmse:1},marketPlusEfficiency:{mae:2,rmse:2},independentEfficiency:{mae:3,rmse:3}},scriptSha256:'a'.repeat(64),sourceBuilderSha256:'b'.repeat(64)},
    dataset:{sourceManifest:{historicalPublicationTimeVerified:false,attribution:'Synthetic test only',license:'Fixture',metadataObservedAt:'2026-11-05T00:00:00Z',sources:[]}}};
}
