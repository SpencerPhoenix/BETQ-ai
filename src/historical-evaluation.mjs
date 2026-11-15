/** Read-only projection of the frozen 2025 development experiment. No fitting or network. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const FROZEN_FILES=Object.freeze({
  'spread-screen.json':'2081da66b9dac6be4e08e6e630b629931c3382a0248e20e0461c6c74add36933',
  'lagged-efficiency-2023-2024-2025.json':'4b9bab600ce82dc95bcb28792d0a76abf01e49701fd6b334e487db0de3a4e8c4'
});
export const MODEL_NAMES=Object.freeze({market:'Recorded market line',marketPlusEfficiency:'Market + efficiency correction',independentEfficiency:'Independent efficiency model'});
export const LIMITATIONS=Object.freeze([
  'Retrospective development evaluation on previously inspected seasons. Not untouched confirmation or prospective performance.',
  'The correction did not beat the recorded market-line benchmark across these 285 games. No verified betting edge, ROI, CLV or wager recommendation.',
  'Historical quote timing, bookmaker identity, executable fills and decision-time input availability are unverified.',
  'The market reference is a recorded closing line, not a live quote. Probability scores use research-estimated residual distributions, not authenticated sportsbook fair probabilities.',
  'Pregame QB availability, injuries and weather are unverified. Past participation does not establish pregame availability.',
  'Analogs are descriptive 2023/2024 similarity examples, not independent validation, causal evidence or a calibrated probability.',
  'These 285 historical outcomes are separate from the qualified prospective-outcome count. No forecast or settlement is added to the journal.'
]);
const fail=()=>{throw new Error('INVALID_FROZEN_HISTORICAL_ARTIFACT');};
const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<1e-8;
const text=(v,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max;
const number=(v)=>{if(!finite(v))fail();return v;};
const id=(v)=>{if(!text(v)||!/^20\d{2}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(v))fail();return v;};
function projection(row){
  if(!row||row.season!==2025||!text(row.home,3)||!text(row.away,3)||row.home===row.away||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.gameDate)||!Number.isInteger(row.week)||!['REG','WC','DIV','CON','SB'].includes(row.gameType)||
    row.decisionTimeInputAvailabilityVerified!==false||row.marketReference?.decisionTimeQuoteVerified!==false||
    row.marketReference?.bookmakerIdentityVerified!==false)fail();
  const gameId=id(row.gameId),actual=number(row.labels?.homeMargin),homeScore=number(row.labels?.homeScore),awayScore=number(row.labels?.awayScore);
  const market=number(row.marketReference?.homeExpectedMargin);
  if(!close(actual,homeScore-awayScore)||!Number.isInteger(homeScore)||!Number.isInteger(awayScore)||homeScore<0||awayScore<0||
    row.labels.spreadPush!==(actual===market)||row.labels.homeCover!==(actual===market?null:actual>market))fail();
  const models=Object.fromEntries(Object.entries(MODEL_NAMES).map(([key,label])=>{
    const source=row.models?.[key],prediction=number(source?.pointForecastHomeMargin),error=prediction-actual;
    if(!close(source.losses?.absoluteMargin,Math.abs(error))||!close(source.losses?.squaredMargin,error**2))fail();
    return [key,{label,margin:prediction,signedError:error,absoluteError:Math.abs(error)}];
  }));
  if(!close(models.market.margin,market))fail();
  const a=row.analogs;
  if(a?.available!==true||!Array.isArray(a.neighbors)||a.neighbors.length!==50||
    a.meaning!=='DESCRIPTIVE_PAST_SIMILARITY_NOT_VALIDATED_PREDICTIVE_PROBABILITY')fail();
  const seen=new Set();
  const neighbors=a.neighbors.map((n,index)=>{
    const gameId=id(n.gameId);if(!/^202[34]_/.test(gameId)||seen.has(gameId))fail();seen.add(gameId);
    const actualMargin=number(n.homeMargin),marketMargin=number(n.recordedSpread),distance=number(n.squaredStandardizedDistance);
    if(distance<0||n.homeCover!==(actualMargin===marketMargin?null:actualMargin>marketMargin)||n.push!==(actualMargin===marketMargin))fail();
    return {rank:index+1,gameId,season:Number(gameId.slice(0,4)),home:gameId.split('_')[3],away:gameId.split('_')[2],actualMargin,marketMargin,
      totalLine:number(n.totalLine),distance,outcome:n.push?'PUSH':n.homeCover?'HOME COVER':'AWAY COVER',
      features:{epaDiff:number(n.features?.epaDiff),successDiff:number(n.features?.successDiff),restDiff:number(n.features?.restDiff)}};
  });
  if(neighbors.some((n,i)=>i>0&&n.distance<neighbors[i-1].distance))fail();
  const homeCovers=neighbors.filter(n=>n.outcome==='HOME COVER').length,pushes=neighbors.filter(n=>n.outcome==='PUSH').length;
  if((a.counts.HOME_COVER||0)!==homeCovers||(a.counts.PUSH||0)!==pushes||(a.counts.AWAY_COVER||0)!==50-homeCovers-pushes||
    !close(a.homeCoverRateGivenNoPush,homeCovers/(50-pushes)))fail();
  const sides=Object.fromEntries(['home','away'].map(side=>{
    const s=row.features?.[side];
    if(s?.currentGameStarterVerified!==false||s?.currentGameQBAvailability!=='UNKNOWN'||!Array.isArray(s.includedGameIds)||
      !text(s.latestIncludedGameDate)||s.latestIncludedGameDate>=row.gameDate)fail();
    return [side,{priorGames:number(s.priorGames),latestIncludedGameDate:s.latestIncludedGameDate,includedGameIds:s.includedGameIds.map(id)}];
  }));
  return {gameId,season:2025,gameDate:row.gameDate,week:row.week,gameType:row.gameType,home:row.home,away:row.away,
    actual:{homeScore,awayScore,margin:actual,spreadOutcome:row.labels.spreadPush?'PUSH':row.labels.homeCover?'HOME COVER':'AWAY COVER'},
    models,features:{epaDiff:number(row.features?.epaDiff),successDiff:number(row.features?.successDiff),restDiff:number(row.features?.restDiff),...sides},
    analogs:{count:50,homeCovers,awayCovers:50-homeCovers-pushes,pushes,homeCoverRateGivenNoPush:homeCovers/(50-pushes),neighbors}};
}

export function buildHistoricalEvaluation(artifact,dataset){
  if(artifact?.schema!==1||artifact.protocol?.id!=='BETQ_FIXED_LAGGED_EFFICIENCY_SPREAD_SCREEN_V1'||
    artifact.protocol?.evaluationSeason!==2025||artifact.protocol?.fitSeason!==2023||artifact.protocol?.residualCalibrationSeason!==2024||
    artifact.protocol?.datasetSha256!==FROZEN_FILES['lagged-efficiency-2023-2024-2025.json']||
    !Array.isArray(artifact.gameBreakdowns)||artifact.gameBreakdowns.length!==285||dataset?.sourceManifest?.historicalPublicationTimeVerified!==false)fail();
  const games=artifact.gameBreakdowns.map(projection).sort((a,b)=>a.gameDate.localeCompare(b.gameDate)||a.gameId.localeCompare(b.gameId));
  if(new Set(games.map(g=>g.gameId)).size!==285)fail();
  const metrics=Object.fromEntries(Object.entries(MODEL_NAMES).map(([key,label])=>{
    const mae=games.reduce((sum,g)=>sum+g.models[key].absoluteError,0)/games.length;
    const rmse=Math.sqrt(games.reduce((sum,g)=>sum+g.models[key].signedError**2,0)/games.length);
    if(!close(mae,artifact.summary?.[key]?.mae)||!close(rmse,artifact.summary?.[key]?.rmse))fail();
    return [key,{label,mae,rmse}];
  }));
  const correctionImproved=games.filter(g=>g.models.marketPlusEfficiency.absoluteError<g.models.market.absoluteError).length;
  const correctionWorsened=games.filter(g=>g.models.marketPlusEfficiency.absoluteError>g.models.market.absoluteError).length;
  const manifest=dataset.sourceManifest;
  const summary={schema:1,mode:'HISTORICAL_2025_FROZEN',available:true,season:2025,gameCount:285,
    regularSeasonGames:games.filter(g=>g.gameType==='REG').length,playoffGames:games.filter(g=>g.gameType!=='REG').length,
    pushGames:games.filter(g=>g.actual.spreadOutcome==='PUSH').length,metrics,
    correction:{improved:correctionImproved,worsened:correctionWorsened,tied:285-correctionImproved-correctionWorsened},
    limitations:[...LIMITATIONS],provenance:{files:{...FROZEN_FILES},protocolId:artifact.protocol.id,protocolRecordedAt:artifact.protocol.recordedAt,
      scriptSha256:artifact.scriptSha256,sourceBuilderSha256:artifact.sourceBuilderSha256,
      fitSeason:2023,calibrationSeason:2024,evaluationSeason:2025,attribution:manifest.attribution,license:manifest.license,licenseUrl:manifest.licenseUrl,
      modificationNotice:'The original derived experiment filtered plays, aggregated strict-lag EPA/success/rest features and fitted the documented research models. This viewer losslessly repackages those frozen files and formats their existing values; it creates no new forecast or research observation.',
      rightsNotice:'Provided without warranties. The retained CC BY 4.0 notice applies only to rights its licensors can grant; upstream rights and official league certification are not independently established.',
      metadataObservedAt:manifest.metadataObservedAt||manifest.observedAt||null,
      similarity:artifact.protocol.similarity,fit:artifact.protocol.fit,status:artifact.protocol.status,
      sources:(manifest.sources||[]).map(s=>({name:s.name,url:s.url,sha256:s.sha256,updatedAt:s.updatedAt,localBytesVerifiedAt:s.localBytesVerifiedAt}))},
    games:games.map(({gameId,gameDate,week,gameType,home,away})=>({gameId,gameDate,week,gameType,home,away}))};
  // Private copies isolate callers; no caller can rewrite the frozen loaded view.
  const byId=new Map(games.map(g=>[g.gameId,g]));
  return {summary:()=>structuredClone(summary),game:gameId=>byId.has(gameId)?structuredClone(byId.get(gameId)):null};
}

export async function loadHistoricalEvaluation(directory){
  const objects=[];
  for(const [name,expected] of Object.entries(FROZEN_FILES)){
    const bytes=await readFile(join(directory,name));
    if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('FROZEN_HISTORICAL_HASH_MISMATCH');
    objects.push(JSON.parse(bytes));
  }
  return buildHistoricalEvaluation(...objects);
}
