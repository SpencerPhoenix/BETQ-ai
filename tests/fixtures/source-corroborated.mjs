// Fabricated receipts for offline unit tests only, never production evidence.
export function withSyntheticCorroboration(result,verifiedAt='2026-11-15T12:00:00.000Z'){
  const identity={season:result.season??2026,home:result.home??'KC',away:result.away??'LV',
    commenceTime:result.commenceTime??result.gameDate+'T18:00:00.000Z'};
  return {...result,...identity,source:'NFLVERSE_SCHEDULES',verifiedAt,
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',
    communitySourceVintage:{sha256:'a'.repeat(64),publicationTimeVerified:false,collectorObservedAt:verifiedAt},
    finalityAttestation:{...identity,status:'CROSS_SOURCE_FINAL',corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
      officialLeagueCertification:false,gameId:result.gameId,gameDate:result.gameDate,
      homeScore:result.homeScore,awayScore:result.awayScore,eventId:'999999999',
      sourceSha256:'b'.repeat(64),observedAt:verifiedAt}};
}
export function syntheticScoringJournal(n=30,qualified=n){
  const journal={schema:1,season:2026,sport:'americanfootball_nfl',provenance:{synthetic:true},snapshots:[],settlements:[]};
  for(let i=0;i<n;i++){
    journal.snapshots.push({id:'fixture-'+i,gameId:'fixture-game-'+i,season:2026,home:'KC',away:'LV',
      gameDate:'2026-11-08',commenceTime:'2026-11-08T18:00:00.000Z',capturedAt:'2026-11-07T12:00:00.000Z',
      modelLastResultDate:'2026-11-06',sourceReceivedAt:'2026-11-07T11:59:59.000Z',modelBuiltAt:'2026-11-07T11:00:00.000Z',
      marketNewestQuoteAt:'2026-11-07T11:59:58.000Z',marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',marketBookCount:4,
      modelHomeProbability:.6,marketHomeProbability:.55,challengerHomeProbability:.65,
      challengerBuiltAt:'2026-11-07T11:00:00.000Z',challengerResearchOnly:true,
      challengerModelVersion:'SYNTHETIC_ONLY',independentModel:true,researchOnly:true});
    const r={gameId:'fixture-game-'+i,gameDate:'2026-11-08',homeScore:27,awayScore:17,outcome:'HOME',revision:1,
      source:'NFLVERSE_SCHEDULES',verifiedAt:'2026-11-15T12:00:00.000Z'};
    journal.settlements.push(i<qualified?withSyntheticCorroboration(r):r);
  }
  return journal;
}
