/**
 * Stream nflverse play-by-play CSV.gz into compact per-game EPA/success summaries.
 * Derived only. No full PBP, play descriptions, player-level data or raw odds
 * are committed to BETQ's repository.
 * Attribution: nflverse/nflverse-data, CC BY 4.0.
 */
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { canonicalTeam } from './nfl-elo.mjs';

const KEYS=['game_id','posteam','defteam','epa','success','play_type','qb_dropback','rush_attempt','season_type'];
const CONTENT_LIMIT=180000000;
const round=(v,d=5)=>Number.isFinite(v)?Number(v.toFixed(d)):null;

export async function foldPbpCsvChunks(chunks,onRow,{maxBytes=CONTENT_LIMIT}={}) {
  let headers=null,needed=null,cell='',row=[],col=0,quoted=false,afterQuote=false,bytes=0,seen=0;
  const accept=(value)=>{
    if(!headers || needed?.has(col))row[col]=value;
    cell='';col++;
  };
  const finish=()=>{
    accept(cell);
    if(!headers){
      headers=row.map(x=>String(x||'').trim());
      needed=new Set(KEYS.map(k=>headers.indexOf(k)).filter(i=>i>=0));
      for(const k of ['game_id','posteam','defteam','epa','play_type','season_type'])
        if(headers.indexOf(k)<0)throw Error('PBP column missing: '+k);
    }else if(row.length){
      const game_id=row[headers.indexOf('game_id')];
      if(game_id){
        const data=Object.fromEntries(KEYS.map(k=>[k,row[headers.indexOf(k)]??'']));
        onRow(data);seen++;
      }
    }
    row=[];col=0;
  };
  for await(const chunk of chunks){
    const text=typeof chunk==='string'?chunk:chunk.toString('utf8');
    bytes+=Buffer.byteLength(text);
    if(bytes>maxBytes)throw Error('PBP source exceeded decompressed size bound');
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'){quoted=false;afterQuote=true;}
        else if(!headers||needed?.has(col))cell+=c;
        continue;
      }
      if(c==='"' && afterQuote){
        if(!headers||needed?.has(col))cell+='"';
        quoted=true;afterQuote=false;continue;
      }
      afterQuote=false;
      if(c==='"'){quoted=true;continue;}
      if(c===','){accept(cell);continue;}
      if(c==='\n'){finish();continue;}
      if(c==='\r')continue;
      if(!headers||needed?.has(col))cell+=c;
    }
  }
  if(quoted)throw Error('Malformed quoted PBP CSV');
  if(cell||col)finish();
  return {seen,bytes,columns:headers?.length||0};
}

export function collectPbpGames(games,allowedIds,season) {
  const byGame=new Map();
  const allowed=new Set(allowedIds);
  let accepted=0;
  const collect=(row)=>{
    const id=row.game_id;
    if(!allowed.has(id)||!id.startsWith(String(season)+'_')||
       !['REG','POST'].includes(row.season_type))return;
    const posteam=canonicalTeam(row.posteam),defteam=canonicalTeam(row.defteam);
    if(!posteam||!defteam||posteam===defteam)return;
    const epa=Number(row.epa);
    const pass=row.play_type==='pass'||row.qb_dropback==='1';
    const rush=row.play_type==='run'||row.rush_attempt==='1';
    if(!(pass||rush)||row.epa===''||!Number.isFinite(epa)||Math.abs(epa)>15)return;
    const success=row.success==='0'||row.success==='1'?Number(row.success):Number(epa>0);
    if(!byGame.has(id))byGame.set(id,new Map());
    const teams=byGame.get(id);
    for(const key of [posteam,defteam]){
      if(!teams.has(key))teams.set(key,{offN:0,offEpa:0,offWins:0,defN:0,defEpa:0,defWins:0});
    }
    const off=teams.get(posteam),def=teams.get(defteam);
    off.offN++;off.offEpa+=Math.max(-10,Math.min(10,epa));off.offWins+=success;
    def.defN++;def.defEpa+=Math.max(-10,Math.min(10,epa));def.defWins+=success;
    accepted++;
  };
  const finish=()=>{
    const out={};
    for(const game of games){
      const teams=byGame.get(game.id);if(!teams)continue;
      const home=teams.get(game.home),away=teams.get(game.away);
      if(!home||!away||home.offN<25||away.offN<25||home.defN<25||away.defN<25)continue;
      function compact(t){
        return {
          offPlays:t.offN,defPlays:t.defN,
          offEPA:round(t.offEpa/t.offN),defEPA:round(t.defEpa/t.defN),
          offSuccess:round(t.offWins/t.offN),defSuccess:round(t.defWins/t.defN)
        };
      }
      out[game.id]={gameId:game.id,season:game.season,week:game.week,date:game.date,
        home:game.home,away:game.away,homeStats:compact(home),awayStats:compact(away)};
    }
    return {games:out,acceptedPlays:accepted,completeGames:Object.keys(out).length};
  };
  return {collect,finish};
}

export async function downloadPbpSeason(season,seasonGames,{
  fetchImpl=globalThis.fetch,log=()=>{}
}={}){
  if(!Number.isInteger(season)||season<1999||season>2100)throw Error('Invalid season');
  const url='https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_'+season+'.csv.gz';
  const allowed=new Set(seasonGames.map(g=>g.id)),collector=collectPbpGames(seasonGames,allowed,season);
  log('Fetching nflverse PBP '+season+' ('+allowed.size+' completed games)');
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok||!response.body)throw Error('PBP download unavailable for '+season+' HTTP '+response.status);
  const compressed=Readable.fromWeb(response.body);
  const decompressed=compressed.pipe(createGunzip());
  const report=await foldPbpCsvChunks(decompressed,collector.collect);
  const result=collector.finish();
  if(result.completeGames<Math.min(25,allowed.size*0.8))throw Error('PBP incomplete / malformed for '+season);
  log('Parsed '+season+' '+result.completeGames+' complete games, '+report.seen+' play rows');
  return {source:url,sourceSeason:season,report:{...result,bytes:report.bytes},games:result.games};
}
