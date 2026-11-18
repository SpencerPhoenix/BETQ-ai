import {createDepthContextFeed,depthContextForGame} from './depth-context.mjs';
import {createStaticRelease} from './static-release.mjs';
import {createScheduledModelFeed} from './scheduled-model-feed.mjs';
import {NFL_TEAMS} from './nfl-elo.mjs';
import {createOfficialGameFeed,evaluateOnDemandGame,gameScope,discoverUpcomingGames} from './on-demand-game.mjs';
import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {describeModelDelivery} from './model-delivery.mjs';
import {describeMarketCaptureContract,MARKET_CAPTURE_CONTRACT,MARKET_CAPTURE_CONTRACT_ID} from './evidence-compat.mjs';
import {performance} from 'node:perf_hooks';
import {collectionHealthFromJournal} from './collection-health.mjs';
import {createOfficialResultFeed} from './official-result-feed.mjs';
import {gradeGamesWithOfficialFinals} from './official-game-grades.mjs';
import {listGameDossiers,buildGameDossier,listRetainedForecasts} from './game-dossier.mjs';
import {getBundledHistoricalEvaluation,HISTORICAL_BUNDLE_DIR} from './historical-bundle.mjs';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createOddsSource, OddsError } from './odds.mjs';
import { analyzeEvents, SPORTS, MARKETS } from './engine.mjs';
import { demoEvents } from './demo.mjs';
import { predictNflEvent, MODEL_VERSION } from './nfl-elo.mjs';
import { nflMoneylineConsensus, selectUnambiguousProviderEvents } from './market-consensus.mjs';
import { emptyJournal, summarizeEvidence } from './evidence.mjs';
import { createJournalEvidenceFeed,recomputeJournalEvidence,validateRetainedJournal } from './evidence-journal-feed.mjs';
import { challengerResearchForEvent } from './nfl-efficiency.mjs';
import {injuryMatchupCoverage} from './injury-matchup-coverage.mjs';
import { injuryContextForGame } from './injuries.mjs';
import {officialRosterContext} from './official-roster-context.mjs';
import {officialInjuryReviews} from './official-injury-review.mjs';
import {createOfficialInjuryFeed} from './official-injury-feed.mjs';
import {createInjuryReportFeed} from './injury-feed.mjs';
import { illustrativePrice, PriceAuditError } from './price-metrics.mjs';
import { assembleAgentRun } from './agent-run.mjs';
import { applyDecisionAuthority } from './decision-policy.mjs';
import { configuredShadowStore } from './shadow-store.mjs';
import { evaluateQBLatency, syntheticQBStudyFixture } from './shadow-study.mjs';
import {createDerivedForwardMarketFeed} from './shadow-derived.mjs';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const SHADOW_PRIVATE = configuredShadowStore();
const SHADOW_SYNTHETIC_REPORT = evaluateQBLatency(syntheticQBStudyFixture());
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
const OFFICIAL_INJURY_REVIEWS=loadResearchArtifact('official_injury_reviews.json',a=>a?.schema===1&&Array.isArray(a.receipts));
export function loadEvidenceJournal({read=()=>readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  '../data/evidence/nfl-2026.json'),'utf8'),clock=Date.now,onInvalid=()=>{}}={}) {
  try {
    const json=JSON.parse(read());
    recomputeJournalEvidence(json,clock()); // Same boundary as the remote journal.
    return json;
  } catch {
    onInvalid();
    return emptyJournal(2026);
  }
}
let BUNDLED_JOURNAL_AVAILABLE=true;
const NFL_EVIDENCE_JOURNAL=loadEvidenceJournal({onInvalid:()=>{BUNDLED_JOURNAL_AVAILABLE=false;}});
const NFL_EVIDENCE=summarizeEvidence(NFL_EVIDENCE_JOURNAL);
const NFL_EVIDENCE_FEED=createJournalEvidenceFeed({fallbackJournal:NFL_EVIDENCE_JOURNAL});
const SHADOW_DERIVED_FEED=createDerivedForwardMarketFeed({fallbackJournal:NFL_EVIDENCE_JOURNAL});
function loadReplayFile(name){
  try {
    const path=resolve(dirname(fileURLToPath(import.meta.url)),'../data/replay/'+name);
    const data=JSON.parse(readFileSync(path,'utf8'));
    return data?.schema===1&&data?.version==='nfl-replay-v2'?data:null;
  } catch{return null;}
}
const NFL_REPLAY_SUMMARY=loadReplayFile('summary.json');
const NFL_REPLAY_FULL=loadReplayFile('nfl_2022_2025.json');
const NFL_RISK_REPORT=loadResearchArtifact('risk/summary.json',a=>
  a?.schema===1&&a?.version==='betq-risk-research-v1'&&
  a?.verifiedROI===null&&a?.verifiedCLV===null&&
  a?.bettingAuthorized===false&&a?.historicalPriceTimeVerified===false&&
  Array.isArray(a.scenarios));
const NFL_MARKET_CHALLENGE=loadResearchArtifact('market-challenge/summary.json',a=>
  a?.schema===1&&a?.version==='market-challenge-v1'&&a?.bettingAuthorized===false&&
  a?.verifiedCLV===null&&a?.verifiedROI===null&&Array.isArray(a.years));
const roundModel = (n, digits = 2) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
const ASSETS = new Map([
  ['/game-card', ['game-card.html','text/html; charset=utf-8']],
  ['/prepared-ledger.js', ['prepared-ledger.js','text/javascript; charset=utf-8']],
  ['/automatic-card.js', ['automatic-card.js','text/javascript; charset=utf-8']],
  ['/game-card.js', ['game-card.js','text/javascript; charset=utf-8']],
  ['/game-card.css', ['game-card.css','text/css; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/game-strategies.js', ['game-strategies.js', 'text/javascript; charset=utf-8']],
  ['/retained-forecasts.js', ['retained-forecasts.js', 'text/javascript; charset=utf-8']],
  ['/game-grades.js', ['game-grades.js', 'text/javascript; charset=utf-8']],
  ['/historical-2025', ['historical-evaluation.html', 'text/html; charset=utf-8']],
  ['/historical-evaluation.js', ['historical-evaluation.js', 'text/javascript; charset=utf-8']],
  ['/historical-evaluation.css', ['historical-evaluation.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
const STATIC_RELEASE = createStaticRelease(ASSETS, file => readFileSync(join(PUBLIC_DIR, file)));
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
const HEALTH_STATUS_TIMEOUT_MS = 500;
function createHealthStatusReader(source) {
  let pending = null;
  const unavailable = reason => ({
    reason,
    odds: {
      configured: typeof source.configured === 'boolean' ? source.configured : null,
      lastSuccess: null, lastError: null, quota: null, cacheEntries: null,
      budget: { persistent: false, available: false, ready: false, reason }
    }
  });
  return () => {
    if (pending) return pending;
    let finish;
    const result = new Promise(resolve => { finish = resolve; });
    pending = result;
    const deadline = performance.now() + HEALTH_STATUS_TIMEOUT_MS;
    // Keep the timed-out operation tracked until it actually settles. Repeated
    // probes share this bounded result rather than queueing more ledger queries.
    const timer = setTimeout(() => finish(unavailable('ODDS_STATUS_TIMEOUT')), HEALTH_STATUS_TIMEOUT_MS);
    function complete(value) {
      clearTimeout(timer);
      pending = null;
      finish(value); // A late success cannot replace an already returned timeout.
    }
    Promise.resolve().then(() => source.status()).then(odds => {
      const reason = performance.now() >= deadline ? 'ODDS_STATUS_TIMEOUT' :
        typeof odds?.configured !== 'boolean' ? 'ODDS_STATUS_UNAVAILABLE' : null;
      complete(reason ? unavailable(reason) : { odds, reason: null });
    }, () => complete(unavailable(performance.now() >= deadline ?
      'ODDS_STATUS_TIMEOUT' : 'ODDS_STATUS_UNAVAILABLE')));
    // Do not cache a successful check: each later probe must verify readiness.
    return result;
  };
}
export function createHandler({
  source = createOddsSource(),
  operatorRefreshToken = process.env.BETQ_OPERATOR_REFRESH_TOKEN || '',
  clock = Date.now,
  scheduledModelFeed = createScheduledModelFeed({clock,fetchImpl:null}),
  officialGameFeed = createOfficialGameFeed({clock,fetchImpl:null}),
  officialResultFeed = createOfficialResultFeed({clock,fetchImpl:null}),
  nflArtifact = NFL_ARTIFACT,
  nflEfficiency = NFL_EFFICIENCY,
  nflInjuries = NFL_INJURIES,
  depthFeed = createDepthContextFeed({fetchImpl:null,clock}),
  officialInjuryArtifact = OFFICIAL_INJURY_REVIEWS,
  officialInjuryFeed = createOfficialInjuryFeed({fallbackArtifact:officialInjuryArtifact,clock,fetchImpl:null}),
  injuryFeed = createInjuryReportFeed({fallbackArtifact:nflInjuries,clock,fetchImpl:null}),
  nflEvidence = NFL_EVIDENCE,
  nflEvidenceJournal = BUNDLED_JOURNAL_AVAILABLE ? NFL_EVIDENCE_JOURNAL : null,
  evidenceFeed = nflEvidenceJournal===(BUNDLED_JOURNAL_AVAILABLE?NFL_EVIDENCE_JOURNAL:null)?NFL_EVIDENCE_FEED:null,
  replaySummary = NFL_REPLAY_SUMMARY,
  replayFull = NFL_REPLAY_FULL,
  marketChallenge = NFL_MARKET_CHALLENGE,
  riskReport = NFL_RISK_REPORT,
  shadowStore = SHADOW_PRIVATE,
  derivedShadowFeed = SHADOW_DERIVED_FEED,
  historicalEvaluation = getBundledHistoricalEvaluation,
  maxAgeMs = Number(process.env.ODDS_MAX_AGE_MS) || 600000
} = {}) {
  const officialGradeConflicts=new Map();
  // Freeze a private copy: a caller cannot mutate the artifact behind its identity.
  nflArtifact=nflArtifact===null?null:structuredClone(nflArtifact);
  function localEvidenceSnapshot(){
    if(typeof evidenceFeed?.peekSnapshot==='function'){
      const current=evidenceFeed.peekSnapshot();
      if(current.journal!==null&&current.summary!==null){
        try{validateRetainedJournal(current.journal,clock());}catch{
          return {...current,journal:null,summary:null,publication:{...current.publication,
            status:'RETAINED_EVIDENCE_NOT_YET_AVAILABLE',lastError:'RETAINED_EVIDENCE_READER_TIME_INVALID'}};
        }
      }
      // An invalid startup bundle is not an empty successful dossier. A later
      // accepted public journal can recover availability without a restart.
      if(nflEvidenceJournal===null&&current.publication.source==='BUNDLED_JOURNAL')
        return {...current,journal:null,summary:null};
      return current;
    }
    let summary=null;
    try{summary=recomputeJournalEvidence(nflEvidenceJournal,clock());}catch{/* Missing remains unavailable. */}
    return {journal:nflEvidenceJournal,summary,publication:null};
  }
  async function currentEvidenceSnapshot(){
    if(typeof evidenceFeed?.getSnapshot==='function')await evidenceFeed.getSnapshot();
    return localEvidenceSnapshot();
  }
  const eloReadiness=at=>{
    if(!nflArtifact)return {available:false,reason:'ARTIFACT_NOT_AVAILABLE'};
    const identity=describeModelDelivery(nflArtifact,at);
    return identity.available?predictNflEvent({home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders'},nflArtifact,at):identity;
  };
  const efficiencyReadiness=at=>!nflEfficiency?{available:false,reason:'CHALLENGER_ARTIFACT_NOT_AVAILABLE'}:challengerResearchForEvent({home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
    commence_time:new Date(at+86400000).toISOString()},0.5,nflEfficiency,at);
  const access = new Map();
  const healthStatus = createHealthStatusReader(source);
  const operatorConfigured=typeof operatorRefreshToken==='string' &&
    /^[A-Za-z0-9._~-]{32,512}$/.test(operatorRefreshToken);
  const tokenDigest=operatorConfigured ? createHash('sha256').update(operatorRefreshToken).digest() : null;
  function paidPermission(req){
    if(req.headers['x-betq-paid-request']!=='true')return false;
    if(!operatorConfigured)throw new OddsError('OPERATOR_REFRESH_NOT_CONFIGURED',503,
      'Paid refresh is disabled until operator authentication is configured. Public reads use cached data only.');
    const header=req.headers.authorization;
    const candidate=typeof header==='string' && /^Bearer [A-Za-z0-9._~-]{32,512}$/.test(header) ? header.slice(7) : '';
    const candidateDigest=createHash('sha256').update(candidate).digest();
    if(!timingSafeEqual(candidateDigest,tokenDigest))throw new OddsError('OPERATOR_AUTH_REQUIRED',401,
      'Paid refresh requires operator authentication. Public reads use cached data only.');
    return true;
  }
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
        const historicalRead=['/api/historical-evaluation','/api/historical-evaluation/game'].includes(url.pathname);
        const accessKey=historicalRead?'historical:'+ip:ip;
        // Frozen browsing has its own bounded allowance; it cannot consume the odds/API quota.
        const bucket = access.get(accessKey) || { resetAt: now + 600000, count: 0 };
        if (bucket.resetAt < now) { bucket.resetAt = now + 600000; bucket.count = 0; }
        // Health checks must not be throttled by user odds traffic behind a shared proxy.
        if(url.pathname!=='/api/health' && url.pathname!=='/api/config') bucket.count++;
        access.set(accessKey, bucket);
        if (access.size > 10000) access.clear();
        if (bucket.count > (historicalRead?600:180) && !['/api/health','/api/config'].includes(url.pathname)) {
          return reply(res, 429, { error: { code: historicalRead?'HISTORICAL_RATE_LIMIT':'LOCAL_RATE_LIMIT', message: 'Too many requests. Try again shortly.' } },
            {'Retry-After':String(Math.max(1,Math.ceil((bucket.resetAt-now)/1000)))});
        }
        if (url.pathname === '/api/health') {
          const {odds,reason:statusReason}=await healthStatus();
          const injuryStatus=injuryFeed.status();
          const healthNow=clock();
          const retained=localEvidenceSnapshot(),eloStatus=eloReadiness(healthNow),efficiencyStatus=efficiencyReadiness(healthNow);
          const reason=statusReason || (!odds.configured?'LIVE_ODDS_SOURCE_NOT_CONFIGURED':!operatorConfigured ? 'OPERATOR_REFRESH_NOT_CONFIGURED' :
            odds.budget?.persistent!==true || odds.budget?.available!==true || odds.budget?.ready!==true ?
              odds.budget?.reason||'DURABLE_BUDGET_NOT_READY' : null);
          return reply(res, 200, {
          status: 'ok', app: 'BETQ.ai', version: '0.11.0', modelOnlyCaptureSchema:2,
          serverTime: new Date(healthNow).toISOString(), odds,
          marketCaptureContract:describeMarketCaptureContract(),
          operatorRefresh:{configured:operatorConfigured,authenticationRequired:true,paidIntentRequired:true},
          captureReadiness:{ready:reason===null,reason,scope:'PROVIDER_REFRESH_PREREQUISITES_ONLY'},
          collectionHealth:collectionHealthFromJournal(retained.journal,healthNow,retained.publication),
          nflModel: { available:eloStatus.available,reason:eloStatus.reason||null,version:nflArtifact?.version||null,
            deliveryIdentity:describeModelDelivery(nflArtifact,healthNow),
            generatedAt:nflArtifact?.generatedAt||null,lastGameDate:nflArtifact?.lastGameDate||null,delivery:'DEPLOYMENT_BUNDLED',
            availabilityScope:'REFERENCE_MATCHUP_CHECK_NOT_ALL_GAMES' },
          forwardEvidence: { available:retained.summary!==null,status:retained.summary?.status||'EVIDENCE_UNAVAILABLE',
            prospectiveGames:retained.summary?.prospectiveGames??null,settledGames:retained.summary?.settledGames??null,
            sourceCorroboratedSettledGames:retained.summary?.sourceCorroboratedSettledGames??null,
            quarantine:retained.summary?.quarantine??null,
            publication:retained.publication },
          nflIntelligence: {
            efficiencyChallengerAvailable:efficiencyStatus.available,
            efficiencyChallengerReason:efficiencyStatus.reason||null,
            efficiencyChallengerPromoted:false,
            injurySourceAvailable:injuryStatus.available,
            injurySource:injuryStatus,
            startingQuarterbacksVerified:false
          }
        });
        }
        if (url.pathname === '/api/config') return reply(res, 200, {
          sports: SPORTS, markets: MARKETS,
          maxAgeMs, refreshMs: null, autoRefresh: false,
          paidRefreshRequiresExplicitRequest: true,
          paidRefreshRequiresOperatorAuthentication: true,
          publicReadsCacheOnly: true,
          marketOnlySignals: true, nflResearchModel: eloReadiness(now).available,
          forwardEvidenceEnabled: true,
          nflEfficiencyChallengerAvailable:efficiencyReadiness(now).available,
          injuryReportAvailable:injuryFeed.status().available,
          startingQuarterbacksVerified:false,
          modelAutomaticallyPromoted:false,
          realMoneyResultsVerified: false,
          closingLineValueVerified: false,
          wageringEnabled: false, injuryDataConnected: false, halftimeModelConnected: false
        });
        if (url.pathname === '/api/prepared-games') return reply(res,200,await scheduledModelFeed.get());
        if (url.pathname === '/api/upcoming-games') return reply(res,200,await discoverUpcomingGames(officialGameFeed,{clock}));
        if (url.pathname === '/api/game-evaluation') {
          const gameId=url.searchParams.get('gameId');
          try{gameScope(gameId);}catch{return reply(res,400,{error:{code:'INVALID_GAME_ID'}});}
          const schedule=await officialGameFeed.get(gameId);
          const evaluation=evaluateOnDemandGame(gameId,{schedule,artifact:nflArtifact,challengerArtifact:nflEfficiency,now:clock(),allowScheduledPreview:url.searchParams.get('preview')==='scheduled'});
          if(evaluation.available)evaluation.depthContext=depthContextForGame(await depthFeed.get(),gameId,evaluation.fixture,clock());
          return reply(res,200,evaluation);
        }
        if (url.pathname === '/api/model/nfl') {
          if (!nflArtifact) return reply(res, 200, {
            available: false, modelVersion: MODEL_VERSION, reason: 'ARTIFACT_NOT_AVAILABLE'
          });
          const sample = eloReadiness(now);
          return reply(res, 200, {
            available: sample.available, reason: sample.available ? null : sample.reason,
            modelVersion: nflArtifact.version, generatedAt: nflArtifact.generatedAt,
            deliveryIdentity:describeModelDelivery(nflArtifact,now),
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
          const sample=efficiencyReadiness(now);
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
          const injuryGameId=url.searchParams.get('gameId');
          if(injuryGameId!==null)try{gameScope(injuryGameId);}catch{return reply(res,400,{error:{code:'INVALID_GAME_ID'}});}
          const [current,official]=await Promise.all([injuryFeed.get(),officialInjuryFeed.get()]);
          return reply(res,200,{...current.status,matchupCoverage:injuryGameId?injuryMatchupCoverage(injuryGameId,current.artifact,{now:clock()}):null,officialReviews:officialInjuryReviews(official.artifact,current.artifact,{now:clock()}),officialRefresh:official.status,rosterContextReviews:officialRosterContext({now:clock()})});
        }
        if (url.pathname === '/api/shadow/status') {
          // Never returns bookmaker identities, prices, article URLs, or DB credentials.
          return reply(res,200,await shadowStore.status());
        }
        if (url.pathname === '/api/shadow/derived') {
          // Current forward market movements from the existing public DERIVED
          // evidence journal; no new Odds API calls or bookmaker identifiers.
          return reply(res,200,await derivedShadowFeed.get());
        }
        if (url.pathname === '/api/shadow/study') {
          // When no private vetted database exists, there is no live study.
          return reply(res,200,await shadowStore.analysis());
        }
        if (url.pathname === '/api/shadow/demo') {
          // Entirely synthetic, immutable fixture; zero odds-provider requests.
          return reply(res,200,SHADOW_SYNTHETIC_REPORT);
        }
        if (['/api/historical-evaluation','/api/historical-evaluation/game'].includes(url.pathname)) {
          if(req.method!=='GET')return reply(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Frozen historical data supports GET only.'}},{Allow:'GET'});
          const detail=url.pathname.endsWith('/game'),pairs=[...url.searchParams];
          if((!detail&&pairs.length)||(detail&&(pairs.length!==1||pairs[0][0]!=='gameId'||!/^2025_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(pairs[0][1]))))
            return reply(res,400,{error:{code:'INVALID_SELECTOR',message:'Choose one frozen 2025 game identifier.'}});
          try{
            const view=typeof historicalEvaluation==='function'?historicalEvaluation():historicalEvaluation;
            if(!view)throw Error('UNAVAILABLE');
            const result=detail?view.game(pairs[0][1]):view.summary();
            return result?reply(res,200,result):reply(res,404,{error:{code:'GAME_NOT_FOUND',message:'No frozen 2025 record matches this game.'}});
          }catch{
            return reply(res,503,{error:{code:'HISTORICAL_VIEW_UNAVAILABLE',message:'The frozen historical bundle is missing or did not pass integrity checks.'}});
          }
        }
        if (url.pathname === '/api/research/grades') {
          if(req.method!=='GET')return reply(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Retained grades support GET only.'}},{Allow:'GET'});
          if([...url.searchParams].length)return reply(res,400,{error:{code:'INVALID_SELECTOR',message:'Retained grades accept no query parameters.'}});
          // Await the same coalesced, validated public journal refresh as other research views.
          const [retained,durable]=await Promise.all([currentEvidenceSnapshot(),officialResultFeed.get()]);
          const result=await gradeGamesWithOfficialFinals(retained.journal,officialGameFeed,{clock,durableLedger:durable?.available?durable.ledger:null,durableStatus:durable,conflictMemory:officialGradeConflicts});
          return reply(res,result.available?200:503,result);
        }
        if (['/api/research/games','/api/research/game','/api/research/forecasts'].includes(url.pathname)) {
          const detail=url.pathname==='/api/research/game';
          const keys=[...url.searchParams.keys()];
          const selector=keys.length===1 && ['gameId','providerEventId'].includes(keys[0]) ? keys[0] : null;
          const value=selector ? url.searchParams.get(selector) : null;
          if ((!detail&&keys.length) || (detail&&(!selector||typeof value!=='string'||
              !value.trim()||value.length>(selector==='providerEventId'?200:140)||/[\u0000-\u001f\u007f]/.test(value)))) {
            return reply(res,400,{error:{code:'INVALID_SELECTOR',message:'Choose exactly one retained game identifier.'}});
          }
          try {
            // Same validated retained source as the Evidence API, never a paid provider.
            const retained=await currentEvidenceSnapshot(),viewNow=clock();
            const options={now:viewNow,publication:retained.publication};
            const result=detail ? buildGameDossier(retained.journal,{[selector]:value,...options}) :
              url.pathname==='/api/research/forecasts' ? listRetainedForecasts(retained.journal,options) :
              listGameDossiers(retained.journal,options);
            if(result.reason==='SCHEDULE_CONFLICT_QUARANTINED')return reply(res,409,{...result,error:{
              code:'SCHEDULE_CONFLICT_QUARANTINED',message:'Conflicting retained kickoff times. This game is excluded from forecasts, scoring and collection; original history is preserved.'}});
            if(result.available!==true)throw Object.assign(new Error('Retained dossier unavailable'),{code:result.reason});
            return reply(res,200,result);
          } catch(error) {
            const codes={GAME_NOT_FOUND:[404,'No retained dossier matches this game.'],
              INVALID_SELECTOR:[400,'Choose exactly one retained game identifier.'],
              AMBIGUOUS_PROVIDER_EVENT_ID:[409,'This provider identifier matches conflicting retained games.'],
              INVALID_RETAINED_JOURNAL:[503,'Retained game evidence is unavailable or did not pass integrity checks.']};
            const code=Object.hasOwn(codes,error?.code)?error.code:'INVALID_RETAINED_JOURNAL';
            const [status,message]=codes[code];
            return reply(res,status,{error:{code,message}});
          }
        }
        if (url.pathname === '/api/evidence/nfl') {
          const summary=typeof evidenceFeed?.getSnapshot==='function'?(await currentEvidenceSnapshot()).summary:
            typeof evidenceFeed?.get==='function'?await evidenceFeed.get():localEvidenceSnapshot().summary;
          if(!summary)return reply(res,503,{error:{code:'EVIDENCE_UNAVAILABLE',message:'Retained evidence is unavailable.'}});
          return reply(res,200,summary);
        }
        if (url.pathname === '/api/risk/nfl') {
          if(!riskReport)return reply(res,200,{
            available:false,reason:'STRESS_REPORT_NOT_PUBLISHED',
            verifiedROI:null,verifiedCLV:null,exactRealWorldRiskOfRuin:null
          });
          return reply(res,200,{
            available:true,...riskReport,verifiedROI:null,verifiedCLV:null,
            exactRealWorldRiskOfRuin:null,bettingAuthorized:false
          });
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
            version:'0.11.0',verifiedROI:null,verifiedCLV:null,
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
          if (!demo && req.method === 'HEAD') return reply(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: 'Live data supports GET only; HEAD never requests provider data.' }
          }, { Allow: 'GET' });
          // Collector pins its checked-out artifact. Reject a deployment race before any source access.
          const expectedModel=req.headers['x-betq-expected-model-sha256'];
          if(expectedModel!==undefined){
            const delivered=describeModelDelivery(nflArtifact,now);
            if(demo||sport!=='americanfootball_nfl'||market!=='h2h'||
              typeof expectedModel!=='string'||!/^[a-f0-9]{64}$/.test(expectedModel)||
              !delivered.available||expectedModel!==delivered.artifactCanonicalSha256)
              return reply(res,409,{error:{code:'MODEL_DELIVERY_MISMATCH',message:'Expected model artifact is not available. No provider request was made.'}});
          }
          const expectedMarketPolicy=req.headers['x-betq-expected-market-policy'];
          if(expectedMarketPolicy!==undefined&&
            (demo||sport!=='americanfootball_nfl'||market!=='h2h'||
              typeof expectedMarketPolicy!=='string'||expectedMarketPolicy!==MARKET_CAPTURE_CONTRACT.policy))
            return reply(res,409,{error:{code:'MARKET_CAPTURE_POLICY_MISMATCH',message:'Expected market-capture policy is not available for this request. No provider request was made.'}});
          const expectedMarketContract=req.headers['x-betq-expected-market-contract'];
          if(expectedMarketContract!==undefined&&
            (demo||sport!=='americanfootball_nfl'||market!=='h2h'||
              typeof expectedMarketContract!=='string'||expectedMarketContract!==MARKET_CAPTURE_CONTRACT_ID))
            return reply(res,409,{error:{code:'MARKET_CAPTURE_CONTRACT_MISMATCH',message:'Expected market freshness and bookmaker identity contract is not available. No provider request was made.'}});
          const snapshot = demo
            ? { events: demoEvents(sport, now), receivedAt: new Date(now).toISOString(), cacheHit: false, quota: null }
            : await source.getOdds(sport, market, {
                allowPaid: paidPermission(req)
              });
          const producerSelection = !demo && sport === 'americanfootball_nfl' && market === 'h2h'
            ? selectUnambiguousProviderEvents(snapshot.events)
            : {events: snapshot.events, integrity: null};
          const [injuryRead,officialRead]=!demo&&sport==='americanfootball_nfl'&&market==='h2h'
            ? await Promise.all([injuryFeed.get(),officialInjuryFeed.get()]) : [null,null];
          const currentInjuries=injuryRead?.artifact||null;
          const captureNow=clock();
          // Private opt-in capture reuses EXACTLY this already paid live response:
          // no second provider call, no demo, no caching-as-new-observation.
          let shadowCapture={captured:false,inserted:0,reason:'NOT_CAPTURED'};
          if(!demo&&sport==='americanfootball_nfl'&&market==='h2h'&&
             snapshot.cacheHit!==true && producerSelection.integrity.excludedEvents===0){
            try{
              shadowCapture=await shadowStore.capture(snapshot,{now:captureNow});
            }catch{
              shadowCapture={captured:false,inserted:0,
                reason:'PRIVATE_CAPTURE_REJECTED'};
            }
          }
          if (producerSelection.integrity?.excludedEvents > 0) {
            shadowCapture={captured:false,inserted:0,reason:'PROVIDER_EVENT_IDENTITY_REJECTED'};
          }
          // Both injury retrieval and private persistence can cross freshness
          // or kickoff boundaries. Evaluate response state after all awaits.
          const analysisNow=clock();
          const analysis = analyzeEvents(producerSelection.events, {
            sport, market, asOf: analysisNow, maxAgeMs, demo, receivedAt: snapshot.receivedAt ?? null
          });
          if (!demo && sport === 'americanfootball_nfl' && market === 'h2h') {
            const rawById = new Map(producerSelection.events.map(e => [e.id, e]));
            for (const game of analysis.events) {
              const rawGame = rawById.get(game.id);
              game.marketConsensus = nflMoneylineConsensus(rawGame, { asOf: analysisNow, receivedAt: snapshot.receivedAt ?? null, maxAgeMs });
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
              const deliveredIdentity=describeModelDelivery(nflArtifact,analysisNow);
              const projection = game.started
                ? { available: false, reason: 'GAME_ALREADY_STARTED' }
                // Preserve explicit venue and kickoff metadata for the model's
                // fail-closed neutral-site and chronology checks.
                : !deliveredIdentity.available?{available:false,reason:deliveredIdentity.reason}:predictNflEvent(rawGame, nflArtifact, analysisNow);
              if(projection.available)projection.deliveryIdentity=deliveredIdentity;
              game.independentModel = projection;
              game.efficiencyChallenger = projection.available ?
                challengerResearchForEvent(rawGame,projection.homeWinProbability,nflEfficiency,analysisNow) :
                {available:false,reason:'ELO_BASELINE_NOT_AVAILABLE'};
              game.injuryContext = injuryContextForGame(rawGame,currentInjuries,analysisNow);
              game.officialInjuryReview = officialInjuryReviews(officialRead?.artifact,currentInjuries,{now:analysisNow}).find(r=>r.home===NFL_TEAMS[rawGame.home_team]&&r.away===NFL_TEAMS[rawGame.away_team]&&Date.parse(r.kickoff)===Date.parse(rawGame.commence_time))||null;
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
            nflModelDelivery:!demo&&sport==='americanfootball_nfl'&&market==='h2h'?describeModelDelivery(nflArtifact,analysisNow):null,
            marketCaptureContract:!demo&&sport==='americanfootball_nfl'&&market==='h2h'?describeMarketCaptureContract():null,
            agentRun,
            shadowCapture,
            producerIntegrity: producerSelection.integrity,
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
          if (req.method === 'HEAD') return reply(res, 405, {
            error: { code: 'METHOD_NOT_ALLOWED', message: 'Live data supports GET only; HEAD never requests provider data.' }
          }, { Allow: 'GET' });
          const snapshot = await source.getScores(sport, {
            allowPaid: paidPermission(req)
          });
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
      if(url.pathname==='/historical-source-license.txt'){
        const body=await readFile(join(HISTORICAL_BUNDLE_DIR,'SOURCE-LICENSE.txt'));
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=300',
          'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':CSP});
        return res.end(req.method==='HEAD'?undefined:body);
      }
      const asset = STATIC_RELEASE.get(url);
      if (!asset) return reply(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
      res.writeHead(asset.status, {
        'Content-Type': asset.type,
        'Cache-Control': asset.cache,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP
      });
      res.end(req.method === 'HEAD' ? undefined : asset.body);
    } catch (err) { safeError(res, err); }
  };
}
export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  let depthArtifact=null;try{depthArtifact=JSON.parse(readFileSync(new URL('../data/nfl_depth_context.json',import.meta.url),'utf8'));}catch{}
  const depthFeed=options.depthFeed??createDepthContextFeed({artifact:depthArtifact,clock:options.clock??Date.now});
  const injuryFeed=options.injuryFeed??createInjuryReportFeed({
    fallbackArtifact:options.nflInjuries===undefined?NFL_INJURIES:options.nflInjuries,
    clock:options.clock??Date.now
  });
  const officialInjuryFeed=options.officialInjuryFeed??createOfficialInjuryFeed({fallbackArtifact:options.officialInjuryArtifact??OFFICIAL_INJURY_REVIEWS,clock:options.clock??Date.now});
  const scheduledModelFeed=options.scheduledModelFeed??createScheduledModelFeed({clock:options.clock??Date.now});
  const officialResultFeed=options.officialResultFeed??createOfficialResultFeed({clock:options.clock??Date.now});
  const officialGameFeed=options.officialGameFeed??createOfficialGameFeed({clock:options.clock??Date.now});
  const server = http.createServer(createHandler({...options,depthFeed,injuryFeed,officialInjuryFeed,officialGameFeed,officialResultFeed,scheduledModelFeed}));
  server.listen(port, '0.0.0.0', () => {
    console.log('[BETQ] terminal listening on port ' + server.address().port);
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer();
}
