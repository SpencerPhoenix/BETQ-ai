/**
 * NFL outcome-only Elo baseline.
 * Source: nflverse/nflverse-data schedules release (CC BY 4.0); maintained by Lee Sharpe.
 * This module does not use betting prices, future outcomes, injuries, or weather.
 */
import {sourceDateFresh, validDay, timestamp} from './integrity.mjs';
export const MODEL_VERSION = 'nfl-elo-1';
export const NFL_TEAMS = Object.freeze({
  'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL',
  'Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI',
  'Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL',
  'Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB',
  'Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX',
  'Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC',
  'Los Angeles Rams':'LA','Miami Dolphins':'MIA','Minnesota Vikings':'MIN',
  'New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG',
  'New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT',
  'San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB',
  'Tennessee Titans':'TEN','Washington Commanders':'WAS'
});
const aliases=Object.freeze({ STL:'LA', OAK:'LV', SD:'LAC', JAC:'JAX', WSH:'WAS' });
export const canonicalTeam = (team) => aliases[team] || team;
export const clampProbability = (p) => Math.max(1e-6,Math.min(1-1e-6,p));
const round = (x,places=4) => Number(x.toFixed(places));

/** RFC 4180-compatible quoted CSV reader for nflverse's game schedule columns. */
export function parseCsv(text) {
  if (typeof text!=='string' || text.length>12000000) throw new Error('Input CSV size invalid');
  const records=[];
  let record=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted && text[i+1]==='"'){cell+='"';i++;}
      else quoted=!quoted;
    } else if(ch===','&&!quoted){record.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      record.push(cell);cell='';
      if(record.some(v=>v!==''))records.push(record);
      record=[];
    } else cell+=ch;
  }
  if(quoted)throw new Error('Unclosed CSV quote');
  if(cell||record.length){record.push(cell);records.push(record);}
  if(!records.length)throw new Error('Empty NFL game CSV');
  const headers=records.shift().map((x,i)=>i===0?x.replace(/^\uFEFF/,''):x);
  for(const field of ['game_id','season','game_type','gameday','away_team','home_team','away_score','home_score','location']){
    if(!headers.includes(field))throw new Error('Missing NFL game column: '+field);
  }
  const rows=records.map(cols=>Object.fromEntries(headers.map((k,i)=>[k,cols[i]??''])));
  return rows;
}
const stages=new Set(['REG','WC','DIV','CON','SB']);
export function cleanGames(rows,{today='9999-12-31'}={}){
  if(!Array.isArray(rows))throw new Error('Invalid rows');
  const seen=new Set();
  const games=[];
  for(const row of rows){
    if(!row || !stages.has(row.game_type))continue;
    const season=Number(row.season),hs=Number(row.home_score),as=Number(row.away_score);
    if(!Number.isInteger(season)||season<1999||season>2099||
       !validDay(row.gameday)||row.gameday>today||
       row.home_score===null||row.away_score===null||String(row.home_score??'').trim()===''||String(row.away_score??'').trim()===''||
       !Number.isInteger(hs)||!Number.isInteger(as)||hs<0||as<0||hs>100||as>100)continue;
    const home=canonicalTeam(row.home_team),away=canonicalTeam(row.away_team);
    if(!home||!away||home===away||!row.game_id||seen.has(row.game_id))continue;
    seen.add(row.game_id);
    games.push({
      id:row.game_id,season,date:row.gameday,week:Number(row.week)||0,
      home,away,homeScore:hs,awayScore:as,neutral:row.location==='Neutral'
    });
  }
  return games.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function eloProbability(homeRating,awayRating,hfa=55,neutral=false){
  if(![homeRating,awayRating,hfa].every(Number.isFinite))throw new Error('Invalid Elo rating');
  return 1/(1+Math.pow(10,((awayRating-homeRating)-(neutral?0:hfa))/400));
}
export function calibrate(p,scale=1){
  if(!Number.isFinite(p)||p<0||p>1||!Number.isFinite(scale)||scale<=0)throw new Error('Invalid probability calibration');
  const clamped=clampProbability(p);
  return 1/(1+Math.exp(-scale*Math.log(clamped/(1-clamped))));
}
export function walkForward(games,opts={}) {
  const k=opts.k??25,homeAdv=opts.homeAdv??55,regression=opts.regression??0.32,scale=opts.scale??1;
  if(![k,homeAdv,regression,scale].every(Number.isFinite)||k<=0||k>100||regression<0||regression>1||scale<=0)
    throw new Error('Invalid Elo parameters');
  const ratings=new Map(),history=[];
  let season=null;
  for(const game of games){
    if(game.season!==season){
      if(season!==null)for(const [team,r] of ratings)ratings.set(team,1500+(r-1500)*(1-regression));
      season=game.season;
    }
    const home=ratings.get(game.home)??1500,away=ratings.get(game.away)??1500;
    const raw=eloProbability(home,away,homeAdv,game.neutral);
    const prediction=calibrate(raw,scale);
    const actual=game.homeScore===game.awayScore?0.5:game.homeScore>game.awayScore?1:0;
    history.push({...game,homeRating:home,awayRating:away,prediction,rawProbability:raw,actual});
    const shift=k*(actual-raw);
    ratings.set(game.home,home+shift);
    ratings.set(game.away,away-shift);
  }
  return { ratings:Object.fromEntries([...ratings].sort((a,b)=>a[0].localeCompare(b[0]))), history,season };
}
export function evaluate(history,filter=()=>true){
  const rows=history.filter(x=>filter(x)&&x.actual!==0.5);
  if(!rows.length)return {n:0,brier:null,logLoss:null,accuracy:null,ece:null,coinFlipBrier:0.25,tiesExcluded:0};
  let brier=0,loss=0,correct=0;
  const bins=Array.from({length:10},()=>({n:0,p:0,y:0}));
  for(const x of rows){
    const p=clampProbability(x.prediction),y=x.actual;
    brier+=(p-y)**2;
    loss-=y*Math.log(p)+(1-y)*Math.log(1-p);
    if((p>=0.5)===(y===1))correct++;
    const bin=bins[Math.min(9,Math.floor(p*10))];
    bin.n++;bin.p+=p;bin.y+=y;
  }
  const ece=bins.reduce((sum,b)=>sum+(b.n?b.n/rows.length*Math.abs(b.p/b.n-b.y/b.n):0),0);
  return {n:rows.length,brier:round(brier/rows.length,5),logLoss:round(loss/rows.length,5),
    accuracy:round(correct/rows.length,4),ece:round(ece,4),coinFlipBrier:0.25,
    tiesExcluded:history.filter(x=>filter(x)&&x.actual===0.5).length};
}
export function fitNflElo(games){
  if(!Array.isArray(games)||games.length<3000)throw new Error('Too few historical games');
  if(!games.some(g=>g.season===2025))throw new Error('The 2025 independent holdout is missing');
  let winner=null;
  for(const k of [12,20,28,40,52]){
    for(const homeAdv of [25,40,55,70,85]){
      for(const regression of [0.25,0.35]){
        const h=walkForward(games,{k,homeAdv,regression}).history;
        const score=evaluate(h,x=>x.season>=2018&&x.season<=2022);
        if(score.n<1000)continue;
        if(!winner||score.logLoss<winner.score.logLoss){
          winner={k,homeAdv,regression,score};
        }
      }
    }
  }
  if(!winner)throw new Error('Insufficient past games for pre-2023 tuning');
  const preds=walkForward(games,{...winner,scale:1}).history;
  let bestScale=null;
  for(const scale of [0.6,0.75,0.9,1,1.1,1.25]){
    const h=preds.map(x=>({...x,prediction:calibrate(x.rawProbability,scale)}));
    const stats=evaluate(h,x=>x.season>=2023&&x.season<=2024);
    if(stats.n<400)throw new Error('Insufficient 2023-24 calibration sample');
    if(!bestScale||stats.logLoss<bestScale.stats.logLoss)bestScale={scale,stats};
  }
  const final=walkForward(games,{...winner,scale:bestScale.scale});
  const holdout=evaluate(final.history,x=>x.season===2025);
  if(holdout.n<250)throw new Error('Insufficient untouched 2025 test sample');
  const currentGames=games.filter(g=>g.season===2026).length;
  return {
    params:{k:winner.k,homeAdv:winner.homeAdv,regression:winner.regression,scale:bestScale.scale},
    tuning:evaluate(final.history,x=>x.season>=2018&&x.season<=2022),
    calibration:evaluate(final.history,x=>x.season>=2023&&x.season<=2024),
    holdout,
    ratings:final.ratings,
    gamesCount:games.length,
    currentSeasonGames:currentGames,
    lastGameDate:games.at(-1)?.date||null,
    seasons:[games[0]?.season,games.at(-1)?.season],
    readyForResearch:holdout.brier<0.25&&bestScale.stats.brier<0.25
  };
}
export function predictNflEvent(event,artifact,now=Date.now()){
  if(!artifact||artifact.schema!==1||artifact.version!==MODEL_VERSION||
     !artifact.readyForResearch||!artifact.params||!artifact.ratings){
    return {available:false,reason:'NO_VALIDATED_BASELINE'};
  }
  if (!Number.isFinite(now)) return {available:false,reason:'INVALID_ASOF'};
  if (event?.commence_time !== undefined && (!Number.isFinite(timestamp(event.commence_time)) || timestamp(event.commence_time)<=now))
    return {available:false,reason:'INVALID_OR_STARTED_EVENT'};
  const generated=Date.parse(artifact.generatedAt);
  if(!Number.isFinite(generated)||generated>now+60000||now-generated>14*86400000){
    return {available:false,reason:'MODEL_SNAPSHOT_STALE'};
  }
  if (!sourceDateFresh(artifact.lastGameDate,now,28)) return {available:false,reason:'MODEL_RESULTS_STALE'};
  if (![artifact.params.homeAdv,artifact.params.scale].every(Number.isFinite) || artifact.params.scale<=0 || !artifact.holdout)
    return {available:false,reason:'MODEL_SCHEMA_INVALID'};
  const home=NFL_TEAMS[event?.home_team],away=NFL_TEAMS[event?.away_team];
  if(!home||!away||home===away||!Number.isFinite(artifact.ratings[home])||!Number.isFinite(artifact.ratings[away]))
    return {available:false,reason:'TEAM_MAPPING_UNAVAILABLE'};
  const p=calibrate(eloProbability(artifact.ratings[home],artifact.ratings[away],artifact.params.homeAdv,
    Boolean(event.neutralSite)),artifact.params.scale);
  return {
    available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',modelVersion:MODEL_VERSION,
    source:'NFLVERSE_SCHEDULES',independentOfOdds:true,
    homeWinProbability:round(p,6),awayWinProbability:round(1-p,6),
    homeElo:round(artifact.ratings[home],1),awayElo:round(artifact.ratings[away],1),
    modelBuiltAt:artifact.generatedAt,throughGameDate:artifact.lastGameDate,
    holdoutN:artifact.holdout.n,holdoutBrier:artifact.holdout.brier,
    calibrationEce:artifact.holdout.ece, injuryAdjusted:false,weatherAdjusted:false,
    verifiedStarters:false, use:'RESEARCH_ONLY'
  };
}
