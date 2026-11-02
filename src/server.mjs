import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createOddsSource, OddsError } from './odds.mjs';
import { analyzeEvents, SPORTS, MARKETS } from './engine.mjs';
import { demoEvents } from './demo.mjs';
import { predictNflEvent, MODEL_VERSION } from './nfl-elo.mjs';
import { nflMoneylineConsensus } from './market-consensus.mjs';
import { emptyJournal, summarizeEvidence } from './evidence.mjs';
import { createEvidenceFeed } from './evidence-feed.mjs';
import { challengerResearchForEvent } from './nfl-efficiency.mjs';
import { injuryContextForGame } from './injuries.mjs';
import { illustrativePrice, PriceAuditError } from './price-metrics.mjs';
import { assembleAgentRun } from './agent-run.mjs';
import { applyDecisionAuthority } from './decision-policy.mjs';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
function loadModelArtifact() {
  try {
    const artifact = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../data/nfl_elo.json'), 'utf8'));
    return artifact?.schema === 1 && artifact?.version === MODEL_VERSION ? artifact : null;
  } catch { return null; }
}
const NFL_ARTIFACT = loadModelArtifact();
function loadResearchArtifact(path,validate){
  try{
    const file=resolve(dirname(fileURLToPath(import.meta.url)),'../data/'+path);
    const a=JSON.parse(readFileSync(file,'utf8'));
    return validate(a)?a:null;
  }catch{return null;}
}
const NFL_EFFICIENCY=loadResearchArtifact('nfl_efficiency.json',a=>
  a?.schema===1&&a?.version==='nfl-efficiency-1'&&
  a?.sourceManifest?.project==='nflverse/nflverse-data'&&a?.readyForResearch);
const NFL_INJURIES=loadResearchArtifact('nfl_injuries.json',a=>
  a?.schema===1&&a?.source==='NFLVERSE_INJURIES');
function loadEvidence() {
  try {
    const json=JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../data/evidence/nfl-2026.json'), 'utf8'));
    return summarizeEvidence(json);
  } catch {
    return summarizeEvidence(emptyJournal(2026));
  }
}
const NFL_EVIDENCE=loadEvidence();
const NFL_EVIDENCE_FEED=createEvidenceFeed({fallback:NFL_EVIDENCE});
function loadReplayFile(name){
  try {
    const path=resolve(dirname(fileURLToPath(import.meta.url)),'../data/replay/'+name);
    const data=JSON.parse(readFileSync(path,'utf8'));
    return data?.schema===1&&data?.version==='nfl-replay-v2'?data:null;
  } catch{return null;}
}
const NFL_REPLAY_SUMMARY=loadReplayFile('summary.json');
const NFL_REPLAY_FULL=loadReplayFile('nfl_2022_2025.json');
const NFL_MARKET_CHALLENGE=loadResearchArtifact('market-challenge/summary.json',a=>
  a?.schema===1&&a?.version==='market-challenge-v1'&&a?.bettingAuthorized===false&&
  a?.verifiedCLV===null&&a?.verifiedROI===null&&Array.isArray(a.years));
const roundModel = (n, digits = 2) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
const CSP = [
  "default-src 'self'", "base-uri 'none'", "connect-src 'self'",
  "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "object-src 'none'", "form-action 'none'", "frame-ancestors 'none'"
].join('; ');

function reply(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP, ...headers
  });
  res.end(JSON.stringify(data));
}
function safeError(res, err) {
  if (err instanceof OddsError) return reply(res, err.status, { error: { code: err.code, message: err.message } });
  console.error('[BETQ] request failed:', err && err.message ? err.message : 'unknown error');
  return reply(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
}
export function createHandler({
  source = createOddsSource(),
  clock = Date.now,
  nflArtifact = NFL_ARTIFACT,
  nflEfficiency = NFL_EFFICIENCY,
  nflInjuries = NFL_INJURIES,
  nflEvidence = NFL_EVIDENCE,
  evidenceFeed = NFL_EVIDENCE_FEED,
  replaySummary = NFL_REPLAY_SUMMARY,
  replayFull = NFL_REPLAY_FULL,
  marketChallenge = NFL_MARKET_CHALLENGE,
  maxAgeMs = Number(process.env.ODDS_MAX_AGE_MS) || 600000
} = {}) {
  const access = new Map();
  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Read-only API.' } });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const ip = req.socket?.remoteAddress || 'unknown';
        const now = clock();
        const bucket = access.get(ip) || { resetAt: now + 600000, count: 0 };
        if (bucket.resetAt < now) { bucket.resetAt = now + 600000; bucket.count = 0; }
        // Health checks must not be throttled by user odds traffic behind a shared proxy.
        if(url.pathname!=='/api/health' && url.pathname!=='/api/config') bucket.count++;
        access.set(ip, bucket);
        if (access.size > 10000) access.clear();
        if (bucket.count > 180 && !['/api/health','/api/config'].includes(url.pathname)) {
          return reply(res, 429, { error: { code: 'LOCAL_RATE_LIMIT', message: 'Too many requests. Try again shortly.' } });
        }
        if (url.pathname === '/api/health') return reply(res, 200, {
          status: 'ok', app: 'BETQ.ai', version: '0.7.0',
          serverTime: new Date(now).toISOString(), odds: source.status(),
          nflModel: { available: Boolean(nflArtifact?.readyForResearch), version: nflArtifact?.version || null },
          forwardEvidence: { status: nflEvidence.status, prospectiveGames: nflEvidence.prospectiveGames,
            settledGames: nflEvidence.settledGames },
          nflIntelligence: {
            efficiencyChallengerAvailable:Boolean(nflEfficiency),
            efficiencyChallengerPromoted:false,
            injurySourceAvailable:Boolean(nflInjuries),
            startingQuarterbacksVerified:false
          }
        });
        if (url.pathname === '/api/config') return reply(res, 200, {
          sports: SPORTS, markets: MARKETS,
          maxAgeMs, refreshMs: null, autoRefresh: false,
          marketOnlySignals: true, nflResearchModel: Boolean(nflArtifact?.readyForResearch),
          forwardEvidenceEnabled: true,
          nflEfficiencyChallengerAvailable:Boolean(nflEfficiency),
          injuryReportAvailable:Boolean(nflInjuries),
          startingQuarterbacksVerified:false,
          modelAutomaticallyPromoted:false,
          realMoneyResultsVerified: false,
          closingLineValueVerified: false,
          wageringEnabled: false, injuryDataConnected: false, halftimeModelConnected: false
        });
        if (url.pathname === '/api/model/nfl') {
          if (!nflArtifact) return reply(res, 200, {
            available: false, modelVersion: MODEL_VERSION, reason: 'ARTIFACT_NOT_AVAILABLE'
          });
          const sample = predictNflEvent({
            home_team: 'Kansas City Chiefs', away_team: 'Las Vegas Raiders'
          }, nflArtifact, now);
          return reply(res, 200, {
            available: sample.available, reason: sample.available ? null : sample.reason,
            modelVersion: nflArtifact.version, generatedAt: nflArtifact.generatedAt,
            lastGameDate: nflArtifact.lastGameDate, readyForResearch: nflArtifact.readyForResearch,
            source: nflArtifact.source, trainingProtocol: nflArtifact.trainingProtocol,
            tuning: nflArtifact.tuning, calibration: nflArtifact.calibration,
            holdout: nflArtifact.holdout, completedGames: nflArtifact.completedGames,
            completed2026: nflArtifact.completed2026, params: nflArtifact.params,
            ratings: nflArtifact.ratings, limitations: nflArtifact.limitations,
            use: 'RESEARCH_ONLY'
          });
        }
        if (url.pathname === '/api/model/efficiency') {
          if(!nflEfficiency)return reply(res,200,{
            available:false,reason:'CHALLENGER_ARTIFACT_NOT_AVAILABLE'
          });
          const sample=challengerResearchForEvent({
            home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
            commence_time:new Date(now+86400000).toISOString()
          },0.5,nflEfficiency,now);
          return reply(res,200,{
            available:sample.available,
            reason:sample.available?null:sample.reason,
            version:nflEfficiency.version,generatedAt:nflEfficiency.generatedAt,
            sourceManifest:nflEfficiency.sourceManifest,
            training:nflEfficiency.training,
            tuning:nflEfficiency.tuning,
            calibration:nflEfficiency.calibration,
            holdout:nflEfficiency.holdout,
            coverage:nflEfficiency.coverage,
            researchOnly:true,
            promotableInHistoricalHoldout:nflEfficiency.promotable,
            automaticallyPromoted:false,
            evaluationVersion:nflEfficiency.evaluationVersion||1,
            statisticalCaveat:'Individual-game bootstrap can overstate confidence; require week-block sensitivity and fresh prospective validation before promotion.',
            independentProspectiveWinRate:null,
            verifiedRealMoneyEdge:false,
            caveats:nflEfficiency.limitations
          });
        }
        if (url.pathname === '/api/injuries/nfl') {
          if(!nflInjuries)return reply(res,200,{
            available:false,reason:'REPORT_SOURCE_NOT_AVAILABLE'
          });
          const age=now-Date.parse(nflInjuries.sourceUpdatedAt);
          return reply(res,200,{
            available:age>=0&&age<=72*3600000,
            source:nflInjuries.source,sourceUpdatedAt:nflInjuries.sourceUpdatedAt,
            playerTimestampAvailable:nflInjuries.perPlayerTimestampsAvailable,
            season:nflInjuries.season,reportCount:nflInjuries.reportCount,
            upcomingFixtures:nflInjuries.fixtures?.length||0,
            starterVerified:false,modelProbabilitiesAdjusted:false,
            advisory:nflInjuries.advisory
          });
        }
        if (url.pathname === '/api/evidence/nfl') {
          return reply(res, 200, await evidenceFeed.get());
        }
        if (url.pathname === '/api/research/market') {
          if(!marketChallenge)return reply(res,200,{
            available:false,reason:'NO_SOURCE_VERIFIED_MARKET_COMPARISON',
            verifiedROI:null,verifiedCLV:null,bettingAuthorized:false
          });
          return reply(res,200,{
            available:true,...marketChallenge,
            verifiedROI:null,verifiedCLV:null,bettingAuthorized:false,
            note:'Closing-moneyline research only; prices were not historically offered at known pregame times.'
          });
        }
        if (url.pathname === '/api/replay/nfl') {
          if(!replaySummary||replaySummary.schema!==1)
            return reply(res,200,{
              available:false,reason:'REPLAY_DATA_NOT_PUBLISHED',
              model:'SEASON_FROZEN_ELO_ONLY',
              verifiedROI:null,verifiedCLV:null
            });
          return reply(res,200,{
            available:true,...replaySummary,verifiedROI:null,verifiedCLV:null,
            dataTrust:'CLOSING_PRICE_RETROSPECTIVE_NOT_VERIFIED_ENTRY'
          });
        }
        if (url.pathname === '/api/replay/nfl/plays') {
          const season=Number(url.searchParams.get('season'));
          const threshold=Number(url.searchParams.get('ev')??'3');
          const page=Number(url.searchParams.get('page')??'0');
          if(![2022,2023,2024,2025].includes(season)||
             ![0,3,5].includes(threshold)||
             !Number.isInteger(page)||page<0||page>20||
             [...url.searchParams.keys()].some(k=>!['season','ev','page'].includes(k)))
            return reply(res,400,{error:{code:'INVALID_REPLAY_FILTER',
              message:'Use season=2022-2025, ev=0/3/5, and page=0-20.'}});
          if(!replayFull)return reply(res,200,{available:false,reason:'REPLAY_DATA_NOT_PUBLISHED'});
          const year=replayFull.years.find(y=>y.season===season);
          if(!year)return reply(res,200,{available:false,reason:'REPLAY_SEASON_UNAVAILABLE'});
          const qualifying=year.decisions.filter(d=>d.priceAvailable&&
            d.estimatedEV>=threshold/100);
          const size=30;
          const rows=qualifying.slice(page*size,(page+1)*size).map(d=>{
            const tie=d.actual==='TIE';
            const win=!tie&&d.actual===d.selectedSide;
            const price=d.selectedOdds;
            const decimal=price>0?1+price/100:1+100/Math.abs(price);
            return {
              gameId:d.gameId,date:d.date,week:d.week,
              matchup:d.away+' @ '+d.home,
              selectedSide:d.selectedSide,selectedTeam:
                d.selectedSide==='home'?d.home:d.away,
              selectedAmericanOdds:price,modelProbability:d.selectedProbability,
              estimatedEVPercent:Number((100*d.estimatedEV).toFixed(2)),
              closingMarketHomeProbability:d.closeMarketHomeProbability,
              gameResult:d.finalScore,
              outcome:tie?'TIE_UNGRADED':win?'WIN':'LOSS',
              hypotheticalUnitProfit:tie?null:Number((win?decimal-1:-1).toFixed(4)),
              executableEntryVerified:false,priceTimeVerified:false,
              priceBasis:'HISTORICAL_CLOSING_REFERENCE_ONLY'
            };
          });
          return reply(res,200,{
            available:true,season,thresholdEVPercent:threshold,
            page,total:qualifying.length,pageSize:size,pageCount:Math.ceil(qualifying.length/size),
            rows,realMoneyROI:null,verifiedCLV:null
          });
        }
        if (url.pathname === '/api/price/verification') {
          return reply(res,200,{
            version:'0.6.0',verifiedROI:null,verifiedCLV:null,
            realMoneyTransactionsConnected:false,
            verifiedBookmakerClosingQuotesConnected:false,
            prospectivePriceLedgerConnected:false,
            performanceClaimsAllowed:false,
            requiredForVerifiedROI:[
              'Confirmed entry stake and actual filled American odds',
              'Transaction ID from an independently verified sportsbook source',
              'Independently verified settlement, including pushes/voids'
            ],
            requiredForVerifiedCLV:[
              'Frozen pregame entry quote with selection and line identity',
              'Matching closing price and both sides of the same market',
              'Source-verified closing time immediately before kickoff'
            ],
            reason:'BETQ has derived market probabilities, not a certified full-odds and real-wager ledger.'
          });
        }
        if (url.pathname === '/api/price/illustration') {
          if (url.search.length > 500) {
            return reply(res,400,{error:{code:'INVALID_PRICING_INPUT',message:'Pricing inputs too long.'}});
          }
          const accepted=new Set(['entry','close','closingOpposite','stake','result']);
          if([...url.searchParams.keys()].some(k=>!accepted.has(k))) {
            return reply(res,400,{error:{code:'INVALID_PRICING_INPUT',message:'Unrecognized pricing input.'}});
          }
          const readInt=(key,optional=false)=>{
            const v=url.searchParams.get(key);
            if(optional&&(v===null||v===''))return null;
            if(v===null||!/^[-+]?\d{3,6}$/.test(v))throw new PriceAuditError(
              'INVALID_PRICING_INPUT','American price must be an explicit signed integer, e.g. -110 or +125.');
            return Number(v);
          };
          const readStake=()=>{
            const v=url.searchParams.get('stake');
            if(v===null||!/^\d{1,7}(?:\.\d{1,2})?$/.test(v))throw new PriceAuditError(
              'INVALID_STAKE','Stake must be an amount with at most two decimals.');
            return Number(v);
          };
          try{
            const result=illustrativePrice({
              entryAmerican:readInt('entry'),
              closingAmerican:readInt('close'),
              closingOppositeAmerican:readInt('closingOpposite',true),
              stake:readStake(),
              result:url.searchParams.get('result')||'OPEN'
            });
            return reply(res,200,result);
          }catch(error){
            if(error instanceof PriceAuditError)
              return reply(res,400,{error:{code:error.code,message:error.message}});
            throw error;
          }
        }
        if (url.pathname === '/api/slate') {
          const sport = url.searchParams.get('sport') || 'americanfootball_nfl';
          const market = url.searchParams.get('market') || 'h2h';
          const mode = url.searchParams.get('mode') || 'live';
          if (!Object.hasOwn(SPORTS, sport) || !Object.hasOwn(MARKETS, market)
              || !['live', 'demo'].includes(mode)) {
            return reply(res, 400, { error: { code: 'INVALID_FILTER', message: 'Unsupported sport, market or mode.' } });
          }
          const demo = mode === 'demo';
          const snapshot = demo
            ? { events: demoEvents(sport, now), receivedAt: new Date(now).toISOString(), cacheHit: false, quota: null }
            : await source.getOdds(sport, market);
          const analysisNow=clock(); // Upstream fetch can cross kickoff or the freshness boundary.
          const analysis = analyzeEvents(snapshot.events, {
            sport, market, asOf: analysisNow, maxAgeMs, demo
          });
          if (!demo && sport === 'americanfootball_nfl' && market === 'h2h') {
            const rawById = new Map(snapshot.events.filter(e=>e && typeof e==='object').map(e => [String(e.id), e]));
            for (const game of analysis.events) {
              const rawGame = rawById.get(game.id);
              game.marketConsensus = nflMoneylineConsensus(rawGame, { asOf: analysisNow, maxAgeMs });
              game.marketAnchoredResearch=game.marketConsensus?.available===true?{
                available:true,
                homeProbability:game.marketConsensus.homeProbability,
                awayProbability:game.marketConsensus.awayProbability,
                modelResidualWeight:0,
                modelIncrementalValueValidated:false,
                source:'FRESH_THREE_BOOK_NO_VIG_CONSENSUS',
                researchOnly:true,wageringAuthorized:false,
                warning:'Market consensus is not an independent BETQ win model or a bet'
              }:{available:false,reason:game.marketConsensus?.reason||'MARKET_UNAVAILABLE'};
              const projection = game.started
                ? { available: false, reason: 'GAME_ALREADY_STARTED' }
                : predictNflEvent({
                    home_team: game.homeTeam, away_team: game.awayTeam
                  }, nflArtifact, analysisNow);
              game.independentModel = projection;
              game.efficiencyChallenger = projection.available ?
                challengerResearchForEvent(rawGame,projection.homeWinProbability,nflEfficiency,analysisNow) :
                {available:false,reason:'ELO_BASELINE_NOT_AVAILABLE'};
              game.injuryContext = injuryContextForGame(rawGame,nflInjuries,analysisNow);
              if (projection.available) {
                for (const signal of game.opportunities) {
                  const p = signal.side === 'home' ? projection.homeWinProbability
                    : signal.side === 'away' ? projection.awayWinProbability : null;
                  if (p === null) continue;
                  signal.eloBaselineProbability = p;
                  signal.eloPriceEdgePoints = roundModel((p - signal.impliedProbability) * 100);
                  signal.eloIndicativeEvPercent = roundModel((p * signal.decimalOdds - 1) * 100);
                  signal.eloStatus = 'RESEARCH_ONLY';
                }
              }
            }
          }
          const agentRun=assembleAgentRun(analysis,replaySummary,{now:analysisNow,marketChallenge});
          applyDecisionAuthority(analysis,agentRun,{asOf:analysisNow});
          return reply(res, 200, {
            ...analysis,
            agentRun,
            receivedAt: snapshot.receivedAt, cacheHit: snapshot.cacheHit,
            quota: snapshot.quota, warnings: [
              'Market consensus is not an independently validated win-probability model.',
              'NFL pregame Elo model is independently backtested on 2025 outcomes but is not injury or starter adjusted; compare with sportsbook market carefully.',
              'Forward evidence is prospectively recorded; reported performance appears only after enough games have final results.',
              'NFL EPA/success/rest challenger is research-only and never auto-promoted from a historical test.',
              'Injury reports are source-timestamped; starting QB decisions and injury probability effects remain unverified.',
              'Other sports and period/halftime bets do not have a trained model yet.',
              'No real wagers are placed. Demo events and prices are entirely synthetic.'
            ]
          });
        }
        if (url.pathname === '/api/scores') {
          const sport = url.searchParams.get('sport') || 'americanfootball_nfl';
          if (!Object.hasOwn(SPORTS, sport)) return reply(res, 400, {
            error: { code: 'INVALID_FILTER', message: 'Unsupported sport.' }
          });
          const snapshot = await source.getScores(sport);
          return reply(res, 200, {
            source: 'THE_ODDS_API_V4', sport, receivedAt: snapshot.receivedAt,
            cacheHit: snapshot.cacheHit, quota: snapshot.quota,
            games: snapshot.events.map(ev => ({
              id: ev.id, homeTeam: ev.home_team, awayTeam: ev.away_team,
              commenceTime: ev.commence_time, completed: Boolean(ev.completed),
              lastUpdate: ev.last_update || null,
              scores: Array.isArray(ev.scores) ? ev.scores : []
            }))
          });
        }
        return reply(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } });
      }
      const asset = ASSETS.get(url.pathname);
      if (!asset) return reply(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
      const body = await readFile(join(PUBLIC_DIR, asset[0]));
      res.writeHead(200, {
        'Content-Type': asset[1],
        'Cache-Control': asset[0] === 'index.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) { safeError(res, err); }
  };
}
export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const server = http.createServer(createHandler(options));
  server.listen(port, '0.0.0.0', () => {
    console.log('[BETQ] terminal listening on port ' + server.address().port);
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer();
}
