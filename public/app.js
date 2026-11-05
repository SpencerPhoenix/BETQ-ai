/* BETQ.ai terminal: no browser API keys, no real sportsbook execution. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STORE = 'betq-terminal-v1';
  const LEDGER = 'betq-paper-v1';
  const allowedTabs = ['overview', 'games', 'signals', 'model', 'evidence', 'latency', 'replay', 'pricing', 'execution', 'audit', 'settings'];
  const marketLabels = { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' };
  const sportLabels = {
    americanfootball_nfl: 'NFL', basketball_nba: 'NBA', baseball_mlb: 'MLB',
    icehockey_nhl: 'NHL', americanfootball_ncaaf: 'NCAAF'
  };
  const safeGet = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  const prefs = safeGet(STORE, {});
  const state = {
    tab: 'overview',
    sport: Object.hasOwn(sportLabels, prefs.sport) ? prefs.sport : 'americanfootball_nfl',
    market: Object.hasOwn(marketLabels, prefs.market) ? prefs.market : 'h2h',
    mode: prefs.mode === 'demo' ? 'demo' : 'live',
    bankroll: Number.isFinite(prefs.bankroll) && prefs.bankroll >= 10 ? prefs.bankroll : 1000,
    maxRisk: Number.isFinite(prefs.maxRisk) && prefs.maxRisk >= 0.1 && prefs.maxRisk <= 1 ? prefs.maxRisk : 1,
    slate: null, error: null, sourceHealth: null, nflModel: null, evidence: null, efficiency: null, injurySource: null,
    pricingResult: null, pricingError: null, priceVerification: null,
    replaySummary: null, replayPlays: null, replayError: null,
    marketChallenge: null,
    riskStress: null,
    shadowStatus: null, shadowStudy: null, shadowDemo: null, shadowDerived: null, shadowView: 'live', shadowError: null,
    replaySeason: 2025, replayThreshold: 3, replayPage: 0, replayLoading: false,
    selectedId: null, search: '', sort: 'ev', watchOnly: false,
    loading: false, ledger: Array.isArray(safeGet(LEDGER, [])) ? safeGet(LEDGER, []) : []
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const num = (v, places = 1) => Number.isFinite(v) ? Number(v).toFixed(places) : '—';
  const odds = (v) => Number.isFinite(v) ? (v > 0 ? '+' : '') + v : '—';
  const signed = (v, places = 1) => Number.isFinite(v) ? (v > 0 ? '+' : '') + num(v, places) : '—';
  const pct = (v, places = 1) => Number.isFinite(v) ? num(v * 100, places) + '%' : '—';
  const usd = (v) => Number.isFinite(v) ? new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2
  }).format(v) : '—';
  const when = (date, opts = {}) => {
    if (!date || !Number.isFinite(Date.parse(date))) return 'Unknown';
    return new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric',
      minute: '2-digit', ...opts });
  };
  const relativeAge = (date) => {
    if (!date || !Number.isFinite(Date.parse(date))) return 'Unknown';
    const mins = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
    return mins < 1 ? 'Just now' : mins + 'm ago';
  };
  const persist = () => {
    localStorage.setItem(STORE, JSON.stringify({
      sport: state.sport, market: state.market, mode: state.mode,
      bankroll: state.bankroll, maxRisk: state.maxRisk
    }));
  };
  const saveLedger = () => localStorage.setItem(LEDGER, JSON.stringify(state.ledger));
  let toastHandle = 0;
  const toast = (text) => {
    const el = $('toast');
    el.textContent = text; el.classList.add('show');
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => el.classList.remove('show'), 3500);
  };
  const all = () => (state.slate?.events || []).flatMap((event) =>
    (event.opportunities || []).map((signal) => {
      const now=Date.now(), at=Date.parse(signal.lastUpdated),kick=Date.parse(event.commenceTime);
      const blocked=!Number.isFinite(at)||at>now+60000||now-at>600000||!Number.isFinite(kick)||kick-now<300000;
      return {...signal,event,quoteAgeSeconds:Number.isFinite(at)?Math.max(0,Math.floor((now-at)/1000)):null,...(blocked?{status:'PASS',theoreticalUnits:0,
        reasons:[...(signal.reasons||[]),'CLIENT_FRESHNESS_GATE']}:{} )};
    }));
  const findSignal = (id) => all().find(s => s.id === id);
  const eventLabel = (event) => event.awayTeam + ' @ ' + event.homeTeam;
  const statusTag = (status) => '<span class="status-tag ' +
    (status === 'WATCH' ? 'watch' : 'pass') + '">' + esc(status === 'WATCH' ? 'PRICE WATCH · NOT A BET' : status) + '</span>';
  const metric = (label, value, sub, color, glyph) =>
    '<article class="metric-card"><div class="metric-top"><span class="metric-label">' +
    esc(label) + '</span><span class="metric-icon">' + glyph +
    '</span></div><div class="metric-val ' + color + '">' + esc(value) +
    '</div><div class="metric-sub">' + esc(sub) + '</div></article>';
  const empty = (title, detail) =>
    '<div class="empty"><div class="empty-icon">◌</div><strong>' + esc(title) +
    '</strong><span>' + esc(detail) + '</span></div>';

  function setTab(tab) {
    if (!allowedTabs.includes(tab)) return;
    state.tab = tab;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));
    const header = document.querySelector('.hero');
    header.hidden = tab !== 'overview';
    header.style.display = tab === 'overview' ? '' : 'none';
    $('breadcrumb-page').textContent = ({
      overview: 'COMMAND CENTER', games: 'GAME MONITOR', signals: 'SIGNAL SCANNER',
      model: 'PREDICTION LAB', evidence: 'FORWARD EVIDENCE', latency: 'QB LATENCY STUDY', replay: 'HISTORICAL REPLAY', pricing: 'ROI & CLV LAB', execution: 'PAPER EXECUTION', audit: 'AUDIT & QUALITY', settings: 'SETTINGS'
    })[tab];
    $('sidebar').classList.remove('open');
    if (tab === 'settings') syncSettings();
    if (tab === 'execution') renderExecution();
    if (tab === 'pricing') renderPricing();
    if (tab === 'replay') renderReplay();
    if (tab === 'latency') { renderShadow(); renderShadowForward(); }
    if (tab === 'audit') renderAudit();
    if (tab === 'model') { renderModel(); renderIntelligence(); }
    if (tab === 'evidence') renderEvidence();
    if (tab === 'signals') renderSignals();
    if (tab === 'games') renderGames();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function requestJSON(path) {
    const response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
    let data = null;
    try { data = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Unable to fetch server data (' + response.status + ').');
      error.code = data?.error?.code || 'REQUEST_FAILED';
      throw error;
    }
    return data;
  }

  function renderBanner() {
    const element = $('banner');
    element.classList.remove('hidden', 'info', 'success');
    if (state.loading && !state.slate) {
      element.classList.add('info');
      element.innerHTML = '<span>◈</span><p>Scanning the market and validating lines…</p>';
    } else if (state.mode === 'demo') {
      element.innerHTML = '<span>◇</span><p><b>SIMULATION MODE.</b> All teams, games, odds and potential edges are fictional. No demo result is a live recommendation. <button type="button" class="text-link" data-mode="live">Switch to live ↗</button></p>';
    } else if (state.error) {
      element.innerHTML = '<span>!</span><p><b>' + esc(state.error.code === 'SETUP_REQUIRED' ? 'LIVE FEED NOT CONFIGURED.' : 'DATA SOURCE UNAVAILABLE.') +
        '</b> ' + esc(state.error.message) +
        ' <button type="button" class="text-link" data-mode="demo">Explore demo ↗</button></p>';
    } else if (state.slate) {
      element.classList.add('info');
      element.innerHTML = '<span>◇</span><p><b>NO VALIDATED BETTING EDGE · PAPER STAGING LOCKED.</b> ↻ refreshes live quotes manually to protect API credits. NFL Elo and the historical EPA challenger appear separately in <button type="button" class="text-link" data-tab="model">Prediction Lab ↗</button>. Injury status may be stale; confirmed starters are not modeled.</p>';
    } else {
      element.classList.add('info');
      element.innerHTML = '<span>◈</span><p>Connecting to the odds provider…</p>';
    }
  }

  function renderFeed() {
    const badge = $('feed-chip');
    const sidebar = $('sidebar-feed');
    const dot = $('sidebar-dot');
    badge.className = 'feed-chip';
    dot.className = 'pulse-dot';
    if (state.mode === 'demo') {
      badge.classList.add('demo');
      badge.innerHTML = '<span class="pulse-dot"></span> SYNTHETIC DEMO';
      sidebar.textContent = 'Synthetic sandbox';
    } else if (state.error || !state.slate) {
      badge.classList.add('offline');
      badge.innerHTML = '<span class="pulse-dot warning"></span> LIVE UNAVAILABLE';
      dot.classList.add('warning');
      sidebar.textContent = 'Live feed not ready';
    } else if (!Number.isFinite(Date.parse(state.slate.receivedAt)) || Date.now()-Date.parse(state.slate.receivedAt)>600000) {
      badge.classList.add('offline');
      badge.innerHTML='<span class="pulse-dot warning"></span> SNAPSHOT EXPIRED';
      dot.classList.add('warning');sidebar.textContent='Refresh required / expired';
    } else {
      badge.innerHTML = '<span class="pulse-dot"></span> LIVE API SNAPSHOT';
      sidebar.textContent = 'The Odds API / active';
    }
  }

  function renderFilters() {
    document.querySelectorAll('[data-sport]').forEach(el => el.classList.toggle('chosen', el.dataset.sport === state.sport));
    document.querySelectorAll('[data-market]').forEach(el => el.classList.toggle('chosen', el.dataset.market === state.market));
    document.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('chosen', el.dataset.mode === state.mode));
  }


  function renderAgentRun(){
    const root=$('agent-run-view');
    if(!root)return;
    const a=state.slate?.agentRun;
    if(!a){
      root.innerHTML=empty('Agent evaluation awaiting current slate',
        state.error ? 'No verified live feed: '+state.error.message :
          'Market and model gates run on the server with every slate request.');
      return;
    }
    const status='<div class="agent-status"><span class="status-tag '+
      (a.decision.startsWith('PASS')?'pass':'watch')+'">'+esc(a.decision)+
      '</span><strong>'+esc(a.reason)+'</strong>'+
      '<small>Checked '+esc(when(a.evaluatedAt))+
      ' · '+a.observedOffers+' price observations · '+a.modelEligibleGames+
      ' eligible NFL projections · '+a.modelPriceCandidatesReviewed+
      ' unapproved research candidates</small></div>';
    const benchmark=a.marketFavorite65Historical;
    const favoriteNote=benchmark?.graded ?
      '<div class="agent-favorite-warning"><b>High accuracy is not a profitable edge.</b> '+
      esc(String(benchmark.graded))+' historical market favorites ≥65% won '+
      num(benchmark.winRatePercent,2)+'%, but their hypothetical closing-price ROI was '+
      signed(benchmark.hypotheticalClosingPriceROIPercent,2)+'%. BETQ has no validated executable advantage.</div>' : '';
    const selectionBias=a.historicalUnderdogSelectionAudit;
    const biasNote=selectionBias?.available?
      '<div class="agent-bias-warning"><b>Selection bias warning:</b> '+
      esc(String(selectionBias.marketUnderdogSelections))+' of '+
      esc(String(selectionBias.candidateSelections))+' historical positive-EV choices ('+
      num(selectionBias.marketUnderdogSharePercent,2)+
      '%) were market underdogs. The model consistently overestimated its favored sides. '+
      'No automatic bet is authorized.</div>' : '';
    const stages=(a.stages||[]).map(stage=>
      '<article class="agent-stage"><span>'+esc(stage.name)+'</span>'+
      '<strong>'+esc(stage.state)+'</strong>'+
      '<small>'+esc(stage.detail)+'</small></article>').join('');
    root.innerHTML=status+'<div class="agent-stage-grid">'+stages+'</div>'+favoriteNote+biasNote+
      '<div class="agent-foot">Historical return is evaluated against recorded closing prices, not verified executable entries. '+
      '<button class="text-link" type="button" data-tab="replay">See seasons &amp; win/loss records ↗</button></div>';
  }



  function renderRiskStress(){
    const root=$('risk-stress-view');if(!root)return;
    const r=state.riskStress;
    if(!r){root.innerHTML=empty('Loading risk stress',
      'Reviewing conditional historical closing-price scenarios; no paid sports API requests.');return;}
    if(!r.available||!Array.isArray(r.scenarios)){
      root.innerHTML=empty('Risk stress not yet published',
        'No validated historical selection sequence is available for the risk calculation.');return;
    }
    const baseline=r.scenarios.find(x=>x.label==='BASELINE_CONDITIONAL_RESAMPLE_1_PERCENT_RISK');
    const adverse=r.scenarios.find(x=>x.label==='ADVERSE_2_PERCENT_WINS_FLIPPED');
    const half=r.scenarios.find(x=>x.label==='HALF_STAKE_CONDITIONAL_RESAMPLE');
    if(!baseline){root.innerHTML=empty('Risk stress incomplete','Expected source-audited scenario not found.');return;}
    const b=baseline.result;
    const stats='<div class="metric-grid">'+
      metric('CONDITIONAL PATHS',String(b.iterations),
        'Seed '+b.seed+' · season/week grouped resampling','', '◉')+
      metric('MEDIAN PATH RETURN',signed(b.endingBankrollReturnPercent.median,2)+'%',
        'Historical hypothetical price sequence; not an actual return','violet','∑')+
      metric('BOTTOM 5% PATH RETURN',signed(b.endingBankrollReturnPercent.p05,2)+'%',
        'Conditional lower-tail scenario · not forecast','', '⌁')+
      metric('PRACTICAL LOSS THRESHOLD',num(b.frequencyCrossingPracticalRuinPercent,2)+'%',
        'Simulated frequency of touching half the starting bankroll','cyan','◇')+'</div>';
    const scenarios=[baseline,adverse,half].filter(Boolean).map(x=>{
      const y=x.result;
      return '<article class="risk-stress-card"><span>'+esc(x.label.replaceAll('_',' '))+
        '</span><strong>'+signed(y.endingBankrollReturnPercent.median,2)+
        '% median</strong><div><small>50% bankroll threshold touched: '+
        num(y.frequencyCrossingPracticalRuinPercent,2)+'%</small>'+
        '<small>95th percentile maximum drawdown: '+
        num(y.pathMaxDrawdownPercent.p95,2)+'%</small>'+
        '<small>Risk per sampled selection: '+num(y.stakePercent,2)+'%</small></div></article>';
    }).join('');
    root.innerHTML='<section class="panel"><div class="panel-head"><div>'+
      '<span class="panel-kicker">HISTORICAL RETROSPECTIVE OUTCOMES · WEEK-BLOCK RESAMPLING</span>'+
      '<h3>Stress-test the selection system, not a marketing confidence score</h3></div>'+
      '<span class="status-tag pass">NO VERIFIED RUIN PROBABILITY</span></div>'+
      '<div class="risk-stress-inner">'+stats+
      '<div class="risk-stress-scenarios">'+scenarios+'</div>'+
      '<p class="risk-stress-note"><b>What these numbers mean:</b> '+
      'The model repeatedly resamples '+String(r.historicalWeekBlocks)+
      ' historical NFL week groups from '+String(r.historicalEligibleDecisions)+
      ' source-completed hypothetical decisions. It starts at '+num(b.startingBankroll,0)+
      ' units and labels touching '+num(b.practicalRuinThreshold,0)+
      ' units a practical loss threshold. Simulated frequencies are conditional on the '+
      'recorded losing strategy and unverified closing odds. This does not measure an exact '+
      'real-world probability of ruin, future profitability or account performance.</p>'+
      '</div></section>';
  }



  function renderShadowForward(){
    const root=$('shadow-forward-view');if(!root)return;
    const r=state.shadowDerived;
    if(!r){
      root.innerHTML=empty('Forward derived market history not loaded',
        'A free read-only summary is being checked; no bookmaker API polling is started.');
      return;
    }
    if(r.available!==true){
      root.innerHTML=empty('No source-dated forward market movement available',
        String(r.reason||'The existing derived journal has not provided eligible observations.'));
      return;
    }
    const shift=r.gamesWithMultipleSeparatedSnapshots;
    const cards='<div class="metric-grid">'+
      metric('FORWARD MARKET OBSERVATIONS',String(r.snapshotMarketAvailable),
        'Historical source-frozen derived probability snapshots','cyan','◉')+
      metric('PRICE-OBSERVED GAMES',String(r.pricedGames),
        'Tracked games · no private bookmaker quotes exposed','', '▤')+
      metric('GAMES WITH SEPARATED QUOTES',String(shift),
        'At least 10 minutes between own capture timestamps','violet','◷')+
      metric('MEDIAN ABSOLUTE MOVE',r.medianObservedAbsoluteMovementPoints===null?'—':
        String(r.medianObservedAbsoluteMovementPoints)+' pp',
        'Observed aggregate probability change · not attributed to QB news','', '⌁')+
      '</div>';
    const moves=(r.preview||[]).map(m=>
      '<tr><td><strong>'+esc(m.matchup)+'</strong><small>Real previously recorded derived snapshots</small></td>'+
      '<td>'+num(m.elapsedMinutes,1)+' min</td>'+
      '<td class="'+(m.observedChangePoints>=0?'positive':'negative')+'">'+
      signed(m.observedChangePoints,2)+' pp</td>'+
      '<td>NOT LINKED TO QB SOURCE</td></tr>').join('');
    const lead=r.prospectiveModelLeadDiagnostic;
    const leadEvidence=lead?.schema===1?(()=>{
      const observed=lead.candidateMarketMovements||0;
      const scored=lead.directionMatchPercent!==null&&lead.directionMatchPercent!==undefined;
      const proof='<div class="shadow-lead-box">'+
        '<div class="shadow-lead-heading"><strong>Does BETQ predict later market movement?</strong>'+
        '<span class="status-tag pass">'+(scored?'DESCRIPTIVE RESEARCH':'INSUFFICIENT FORWARD SAMPLE')+'</span></div>'+
        '<div class="metric-grid">'+
        metric('TIMESTAMP-PAIRED GAMES',String(lead.gamesWithEligiblePairedObservations||0),
          'First forecast and later derived quote at least 15 min apart','cyan','◷')+
        metric('MATERIAL MARKET MOVES',String(observed),
          'Requires first model gap ≥3 pp and later price move ≥0.5 pp','','◉')+
        metric('DIRECTION MATCHES',String(lead.qualifyingDirectionMatches||0)+' / '+observed,
          'Matches not proof of an executable price or a causal effect','violet','⌁')+
        metric('DIRECTION HIT RATE',scored?num(lead.directionMatchPercent,2)+'%':'WITHHELD',
          scored?'Descriptive only · not economically validated':
            String(lead.missingToReport)+' additional distinct games needed','', '◇')+
        '</div>'+
        '<p class="shadow-live-notice"><b>Evidence standard:</b> This tests whether the earliest '+
        'already-recorded Elo disagreement points in the direction of a later market consensus shift. '+
        'It uses the same free prospective journal and counts each game once. '+
        'It cannot establish sportsbook entry prices, real CLV, profitability, or QB-news causation. '+
        'The minimum reporting sample is 30 distinct qualified games, which still is not proof of a predictive edge.</p>'+
        '</div>';
      return proof;
    })():'<p class="shadow-diagnostic">Source-frozen model-vs-later-market audit is not available.</p>';
    const sequential=r.sequentialMarketEvidence;
    const sequentialBox=sequential?.version==='betq-market-sequential-v1'&&
      sequential.outcomeScoringPolicy==='SOURCE_CORROBORATED_SETTLEMENT_V1'&&
      sequential.sourceIndependenceVerified===false?(()=>{
      const settled=sequential.eligibleSettledNonTieGames||0,
        readable=Number.isInteger(settled)&&settled>=30&&sequential.properScores?.n===settled;
      const evidence=sequential.candidateEvidence;
      const score=sequential.properScores;
      return '<div class="shadow-lead-box">'+
        '<div class="shadow-lead-heading"><strong>Forward outcome evidence versus the market</strong>'+
        '<span class="status-tag pass">'+(readable?'RESEARCH ONLY':'AWAITING 30 FINAL GAMES')+'</span></div>'+
        '<div class="metric-grid">'+
        metric('QUALIFIED FINAL GAMES',String(settled),
          'One frozen forecast per source-corroborated NFL result','cyan','▤')+
        metric('REMAINING TO REPORT',String(sequential.gamesNeededForDescriptiveScore),
          '30-game minimum is a display gate, not proof of an advantage','','◷')+
        metric('MARKET VS ELO BRIER',readable?
          num(score.marketBrier,5)+' / '+num(score.eloBrier,5):'WITHHELD',
          'Matched game outcomes · smaller score is better','violet','◇')+
        metric('CONDITIONAL MODEL EVIDENCE',readable?
          num(evidence.fixedMixtureEvidence,3)+'×':'WITHHELD',
          'Requires an unproven efficient-market probability assumption','','⌁')+
        '</div><p class="shadow-live-notice"><b>No verified profitability.</b> '+
        'A precommitted 50/50 Elo/efficiency likelihood comparison uses the first '+
        'eligible forecast and a later source-corroborated result. Source independence is unverified. If no efficiency '+
        'forecast was present initially, its contribution is neutral. '+
        'This diagnostic assumes the market probability is the true conditional '+
        'outcome probability, which is not established, and cannot demonstrate '+
        'tradable mispricing, actual sportsbook fills, real CLV or ROI.</p></div>';
    })():'';
    root.innerHTML=cards+leadEvidence+sequentialBox+
      (moves?'<div class="table-scroll"><table class="data-table shadow-forward-table">'+
        '<thead><tr><th>GAME</th><th>OBSERVATION SPAN</th><th>HOME P CHANGE</th><th>NEWS LINKAGE</th></tr></thead>'+
        '<tbody>'+moves+'</tbody></table></div>':
        '<p class="shadow-diagnostic">Multiple observations at least 10 minutes apart are not yet available for a per-game movement comparison.</p>')+
      '<p class="shadow-live-notice"><b>Actual source-derived forward history, not a trading signal.</b> '+
      'These snapshots contain only aggregate no-vig market probabilities already collected by BETQ. '+
      'They do not identify an accepted bookmaker offer, first publication of quarterback news, '+
      'a matched price movement event, closing-line value, or a real-money return.</p>';
  }

  function renderShadow(){
    const readiness=$('shadow-readiness'),study=$('shadow-study-view');
    if(!readiness||!study)return;
    const status=state.shadowStatus;
    if(!status){
      readiness.innerHTML=empty('No private archive connected',
        state.shadowError||'Research status is unavailable; capture defaults to OFF.');
    }else{
      const running=status.available===true&&status.captureEnabled===true&&
        status.durableStorage===true;
      readiness.innerHTML='<div class="metric-grid">'+
        metric('LIVE ARCHIVAL',running?'PRIVATE COLLECTION READY':'NOT COLLECTING',
          'Requires a dedicated private PostgreSQL database and explicit license review',
          running?'lime':'','◷')+
        metric('SOURCE-REVIEWED QB EVENTS',
          running?String(status.independentlyReviewedQBEvents??0):'—',
          'Official announcement candidate plus independent source review','violet','▤')+
        metric('RECORDED QUOTE REVISIONS',
          running?String(status.recordedQuoteRevisions??0):'—',
          'Never presented as verified bettable prices','cyan','⌁')+
        metric('ACTUAL CLV / ROI','UNAVAILABLE',
          'No authenticated accepted bets or settlements','', '∅')+
        '</div>'+
        '<p class="shadow-live-notice"><b>'+esc(running?
          'Dedicated private capture configured.':'Safe mode: disabled by default.')+
        '</b> '+esc(status.reason||'No private capture status provided.')+
        ' Historical Odds API requests, automatic polling, and real wagering remain off. '+
        'This page does not trigger sportsbook requests.</p>';
    }
    document.querySelectorAll('[data-shadow-view]').forEach(b=>
      b.classList.toggle('active',b.dataset.shadowView===state.shadowView));
    const live=state.shadowView==='live';
    const result=live?state.shadowStudy:state.shadowDemo;
    if(!result){
      study.innerHTML=empty('No observational study available',
        'Read-only synthetic example or private source summary not loaded.');
      return;
    }
    if(!live){
      if(result.synthetic!==true){
        study.innerHTML=empty('Demo provenance failed',
          'A genuine QB study cannot be substituted for synthetic fixture data.');return;
      }
      study.innerHTML='<div class="shadow-mode-warning"><b>100% FICTIONAL EXAMPLE — NOT A REAL NFL QB UPDATE OR OBSERVED BOOKMAKER PRICE.</b> No predictive accuracy, execution, or profitable opportunity is implied.</div>'+
        '<div class="metric-grid">'+
        metric('FICTIONAL QB SOURCE EVENTS',String(result.nQBEventsEligible),
          'Collector first-seen and independent simulated review','violet','◇')+
        metric('HYPOTHETICAL QB-TEAM MOVE',
          result.outcome?.median60mQBTeamMovementPoints===null?'—':
            String(result.outcome.median60mQBTeamMovementPoints)+' pp',
          'Fictional 60-minute de-vigged price movement','cyan','↗')+
        metric('FICTIONAL TIME TO NOTICEABLE CHANGE',
          result.outcome?.medianObservedMaterialMoveLatencyMinutes===null?'—':
            String(result.outcome.medianObservedMaterialMoveLatencyMinutes)+' min',
          'At least a 0.5 percentage-point movement','', '◷')+
        metric('BOOKMAKER EXECUTABILITY','NOT VERIFIED',
          'No real provider feed or accepted transaction','', '∅')+
        '</div>'+
        '<p class="shadow-diagnostic">The synthetic workflow compares an official-looking QB report candidate, '+
        'a separate human review time, matching quote revisions from four fictional books, and two fictional comparison games. '+
        'Actual studies must use observed source timestamps, independent review, enough matched controls, and private durable storage.</p>';
      return;
    }
    const useReal=result.available===true&&result.eventCount>=10&&
      result.outcome&&status?.available===true;
    study.innerHTML='<div class="shadow-mode-warning"><b>REAL STUDY STATUS — '+
      esc(useReal?'DESCRIPTIVE ASSOCIATION ONLY':'NO ELIGIBLE VERIFIED COHORT YET')+
      '</b> No actual wager or causal sportsbook repricing effect has been established.</div>'+
      '<div class="metric-grid">'+
      metric('REPORTABLE QB EVENTS',useReal?String(result.reportableEffects):'—',
        'Minimum ten source-reviewed events with matched bookmaker/control observations','', '▤')+
      metric('OBSERVED QB-TEAM MOVEMENT',useReal?
        String(result.outcome.median60mQBTeamMovementPoints)+' pp':'—',
        'Descriptive first-observed after reviewed announcement','cyan','↗')+
      metric('OBSERVED REPRICING DELAY',useReal?
        String(result.outcome.medianObservedMaterialMoveLatencyMinutes)+' min':'—',
        'Only collector-observed market updates; no historical backfill','', '◷')+
      metric('CAUSAL EDGE / VERIFIED CLV','NOT ESTABLISHED',
        'No independently certified controls, executable fills or price advantage','violet','∅')+
      '</div>'+
      '<p class="shadow-diagnostic">'+esc(result.reason||
        'No reviewed matched-control cohort is available.')+
      '. Absence of a recorded QB event in a comparison game does not prove the game had no other news. '+
      'Source article publication time does not establish when a sportsbook quote was available.</p>';
  }

  function renderMarketChallenge(){
    const root=$('market-challenge-view');if(!root)return;
    const report=state.marketChallenge;
    if(!report){root.innerHTML=empty('Loading market calibration challenge',
      'Reading independent historical market-quality and hit-rate research…');return;}
    if(!report.available){
      root.innerHTML=empty('Market benchmark not available',
        'No completed, source-attributed prior-season blend analysis is published.');return;
    }
    const fave60=report.pooledPolicy?.MARKET_FAVORITE_60;
    const fave65=report.pooledPolicy?.MARKET_FAVORITE_65;
    const fave70=report.pooledPolicy?.MARKET_FAVORITE_70;
    const weights=report.years||[];
    const allZero=weights.length>=4&&weights.every(x=>x.modelContributionWeight===0);
    const tiles='<div class="metric-grid">'+
      metric('INDEPENDENT ELO WEIGHT',
        allZero?'0%':'NOT APPROVED',
        'Weight selected by strictly prior-season error tests','', '◇')+
      metric('HISTORICAL FAVORITE HIT RATE',
        fave65?num(fave65.winRatePercent,2)+'%':'—',
        'Favorite with market win probability ≥65%, research only','lime','◉')+
      metric('HYPOTHETICAL FAVORITE ROI',
        fave65?signed(fave65.hypotheticalClosingPriceROIPercent,2)+'%':'—',
        'Unverified closing-price fills, flat risk units','', '∑')+
      metric('REAL MONEY EDGE','NOT VERIFIED',
        'Prospective filled entry and real CLV still required','violet','⌁')+
      '</div>';
    const years=weights.map(y=>{
      const fav=y.favoriteScenarios.find(r=>r.ruleId==='MARKET_FAVORITE_65');
      return '<tr><td><b>'+esc(y.season)+'</b></td>'+
        '<td>'+num(y.originalElo.brier,5)+'</td>'+
        '<td>'+num(y.closingMarket.brier,5)+'</td>'+
        '<td>'+num(y.conservativelyCalibrated.brier,5)+'</td>'+
        '<td>'+num(y.modelContributionWeight*100,0)+'%</td>'+
        '<td>'+fav.wins+'–'+fav.losses+'</td>'+
        '<td>'+num(fav.winRatePercent,2)+'%</td>'+
        '<td class="'+(fav.hypotheticalClosingPriceROIPercent>=0?'positive':'negative')+'">'+
        signed(fav.hypotheticalClosingPriceROIPercent,2)+'%</td></tr>';
    }).join('');
    const candidates=[['60%',fave60],['65%',fave65],['70%',fave70]]
      .map(([name,x])=>x?'<article class="market-compare-card"><span>FAVORITE ≥'+name+
      ' MARKET PROBABILITY</span><strong>'+num(x.winRatePercent,2)+'% win rate</strong>'+
      '<small>'+x.wins+'–'+x.losses+' historical games · '+
      signed(x.hypotheticalClosingPriceROIPercent,2)+
      '% hypothetical ROI</small></article>':'').join('');
    root.innerHTML='<section class="panel market-challenge-panel">'+
      '<div class="panel-head"><div><span class="panel-kicker">NESTED PAST-ONLY TESTING</span>'+
      '<h3>Can BETQ actually improve the market?</h3></div>'+
      '<span class="status-tag pass">INDEPENDENT EDGE NOT VERIFIED</span></div>'+
      '<div class="market-challenge-inner">'+tiles+
      '<p class="market-diagnostic"><b>Outcome:</b> '+
      (allZero?'Past-year calibration rejected every attempted Elo contribution.' :
      'No statistically defensible model advantage has been promoted.')+
      ' We use fresh multi-book market probabilities as a reference, not as an independently generated BETQ edge. '+
      'Higher winner accuracy alone is not enough: expensive favorites can win often and still lose money.</p>'+
      '<div class="market-compare-grid">'+candidates+'</div>'+
      '<div class="table-scroll"><table class="data-table market-challenge-table">'+
      '<thead><tr><th>SEASON</th><th>ELO BRIER</th><th>MARKET BRIER</th>'+
      '<th>GATED BLEND BRIER</th><th>MODEL WEIGHT</th><th>FAVORITE W–L</th>'+
      '<th>FAVORITE WIN %</th><th>HYP. ROI</th></tr></thead>'+
      '<tbody>'+years+'</tbody></table></div>'+
      '<p class="market-challenge-note">All market-favorite strategies are <b>retrospective research only</b>. '+
      'Bookmaker closing moneylines lack verified historical entry timestamps, and no strategy here is live-bet authorized. '+
      'Past-year parameter decisions do not know future outcomes, but the broader modeling project has already inspected these seasons.</p>'+
      '</div></section>';
  }

  function renderReplay(){
    const root=$('replay-overview'),table=$('replay-plays'),page=$('replay-page-label');
    if(!root||!table||!page)return;
    const rep=state.replaySummary;
    if(!rep?.available){
      root.innerHTML=empty('Preparing historical replay',
        state.replayError||'Season-frozen historical replay artifact has not finished publishing.');
      table.innerHTML=empty('No selections yet','The historical source report is not available.');
      page.textContent='No pages';
      return;
    }
    const selected=String(state.replayThreshold);
    const combined=rep.aggregateByThreshold?.[selected];
    const grades=combined?combined.wins+'–'+combined.losses:'—';
    const rows=(rep.years||[]).map(y=>{
      const chosen=y.selectionRules.find(r=>r.thresholdEVPercent===state.replayThreshold);
      return '<tr><td><button type="button" class="text-link" data-replay-season="'+y.season+
        '">'+y.season+'</button></td><td>'+num(y.allGameForecast.accuracyPercent,2)+
        '%</td><td>'+num(y.closingMarketBenchmark?.favoriteWinnerAccuracyPercent,2)+
        '%</td><td>'+num(y.allGameForecast.brier,5)+
        '</td><td class="positive">'+num(y.closingMarketBenchmark?.brier,5)+
        '</td><td>'+y.closingMoneylineCoverage.coveragePercent+
        '%</td><td><strong>'+chosen.wins+'–'+chosen.losses+
        '</strong><small>'+chosen.graded+' graded</small></td>'+
        '<td>'+num(chosen.expectedSelectionWinRatePercent,2)+'%</td>'+ 
        '<td>'+num(chosen.winRatePercent,2)+'%</td>'+
        '<td class="'+(chosen.hypotheticalClosingPriceROI>=0?'positive':'negative')+'">'+
        signed(chosen.hypotheticalClosingPriceROI,2)+'%</td></tr>';
    }).join('');
    const summary='<div class="metric-grid">'+
      metric('PICKS GRADED',combined?.graded===undefined?'—':String(combined.graded),
        'Fixed '+state.replayThreshold+'% modeled EV gate · one side/game','', '⌁')+
      metric('WINS / LOSSES',grades,
        combined?.graded?num(combined.winRatePercent,2)+'% hit rate':'No graded selections',
        'violet','◉')+
      metric('HYPOTHETICAL ROI',combined?.hypotheticalClosingPriceROI===null?'—':
        signed(combined.hypotheticalClosingPriceROI,2)+'%',
        'Closing-price assumption · not fill verified',
        '','∑')+
      metric('PICK CALIBRATION GAP',
        combined?.actualMinusForecastWinPoints===null?'—':
          signed(combined.actualMinusForecastWinPoints,2)+' pp',
        'Actual win rate minus model prediction on selected sides','cyan','◇')+
      '</div>';
    root.innerHTML=summary+
      '<p class="replay-calibration-note">A correct all-game winner is not automatically a profitable price. The model\'s average predicted win rate on <b>its selected sides</b> must be compared with actual selection wins. A large negative gap signals overconfidence or poor selection.</p>'+
      '<section class="panel replay-season-panel"><div class="panel-head"><div>'+
      '<span class="panel-kicker">ALL GAMES VS FILTERED SELECTIONS</span>'+
      '<h3>Season-by-season results</h3></div>'+
      '<span class="faint-caption">LOWER BRIER IS BETTER</span></div>'+
      '<div class="table-scroll"><table class="data-table replay-season-table">'+
      '<thead><tr><th>SEASON</th><th>ALL-GAME WIN %</th><th>MARKET WIN %</th><th>BETQ BRIER</th>'+
      '<th>MARKET BRIER</th><th>PRICE COVERAGE</th><th>PLAY W–L</th><th>MODEL PICK WIN %</th>'+
      '<th>PICK WIN %</th><th>HYP. ROI</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div></section>'+
      '<div class="notice replay-warning"><span>!</span><p>'+
      '<b>Findings must not be marketed as proof of winning.</b> Lower error in the closing-market column means '+
      'bookmakers were more accurate at assigning probabilities that season. '+
      'Closing prices alone cannot establish when an offer was available, a real-money return, or CLV.</p></div>';
    if(state.replayError){
      table.innerHTML=empty('Unable to load selected plays',state.replayError);
      page.textContent='No pages';return;
    }
    if(state.replayLoading&&!state.replayPlays){
      table.innerHTML=empty('Loading historical decisions','No paid sportsbook credits are used.');
      return;
    }
    const plays=state.replayPlays;
    if(!plays?.available||!Array.isArray(plays.rows)){
      table.innerHTML=empty('No selected plays','Choose a historical season and a model EV threshold.');
      page.textContent='No pages';return;
    }
    const lines=plays.rows.map(p=>
      '<tr><td><strong>'+esc(p.matchup)+'</strong><small>'+
      esc(p.date)+' · Week '+esc(p.week)+'</small></td>'+
      '<td>'+esc(p.selectedTeam)+'</td><td><span class="odds-pill">'+
      esc(odds(p.selectedAmericanOdds))+'</span></td>'+
      '<td>'+pct(p.modelProbability,1)+'</td>'+
      '<td class="'+(p.estimatedEVPercent>=0?'positive':'negative')+'">'+
      signed(p.estimatedEVPercent,2)+'%</td><td>'+
      '<span class="status-tag '+(p.outcome==='WIN'?'watch':'pass')+'">'+
      esc(p.outcome)+'</span><small>Final '+esc(p.gameResult)+'</small></td>'+
      '<td class="'+(p.hypotheticalUnitProfit>=0?'positive':'negative')+'">'+
      (p.hypotheticalUnitProfit===null?'—':signed(p.hypotheticalUnitProfit,2)+'u')+
      '</td></tr>').join('');
    table.innerHTML='<div class="table-scroll"><table class="data-table replay-plays-table">'+
      '<thead><tr><th>GAME</th><th>RESEARCH SIDE</th><th>CLOSE ODDS</th>'+
      '<th>MODEL P</th><th>EST. EV</th><th>RESULT</th><th>1u P/L</th></tr></thead>'+
      '<tbody>'+lines+'</tbody></table></div>'+
      '<p class="replay-table-note">'+esc(String(plays.total))+' rule-qualified decisions. '+
      'Historical closing odds are not verified offered entry prices. '+esc(String(plays.season))+
      ' / '+esc(String(plays.thresholdEVPercent))+'% modeled EV gate.</p>';
    page.textContent='Page '+(plays.page+1)+' of '+Math.max(1,plays.pageCount);
  }

  function renderMetrics() {
    const s = state.slate?.summary;
    const signals = all();
    const watch = signals.filter(x => x.status === 'WATCH');
    const best = watch.length ? Math.max(...watch.map(x => x.evPercent || 0)) : null;
    const quality = signals.length ? Math.round(signals.reduce((sum, x) => sum + x.qualityScore, 0) / signals.length) : null;
    const quota = state.slate?.quota?.remaining;
    $('metric-grid').innerHTML =
      metric('GAMES TRACKED', s ? String(s.games) : '—', sportLabels[state.sport] + ' / ' + marketLabels[state.market], '', '◉') +
      metric('PRICE WATCHES', s ? String(watch.length) : '—', 'Market-only differences · no bet', 'lime', '⌁') +
      metric('BEST INDICATIVE EV', best === null ? '—' : signed(best) + '%', 'Not calibrated to future outcomes', 'violet', '↗') +
      metric('QUALITY / 100', quality === null ? '—' : String(quality), quota === null || quota === undefined ? 'Quota not reported' : 'API credits left: ' + quota, 'cyan', '◇');
    $('last-refreshed').textContent = state.slate ? 'Data received ' + when(state.slate.receivedAt) +
      (state.slate.cacheHit ? ' · Cached' : ' · Fresh request') : 'No current snapshot';
  }

  function renderOpportunities() {
    const signals = all().sort((a, b) =>
      (b.status === 'WATCH') - (a.status === 'WATCH') || (b.evPercent ?? -999) - (a.evPercent ?? -999));
    const rows = signals.slice(0, 8).map(s => {
      const selected = state.selectedId === s.id ? ' class="selected"' : '';
      return '<tr' + selected + ' data-pick="' + esc(s.id) + '" tabindex="0"><td><strong>' +
        esc(s.selection) + '</strong><small>' + esc(eventLabel(s.event)) +
        '</small></td><td><span class="odds-pill">' + esc(odds(s.americanOdds)) +
        '</span><small>' + esc(s.bookmaker) + '</small></td><td>' + pct(s.fairProbability) +
        '</td><td class="' + (s.edgePoints > 0 ? 'positive' : 'negative') + '">' +
        signed(s.edgePoints) + 'pp</td><td class="' + (s.evPercent > 0 ? 'positive' : 'negative') +
        '">' + signed(s.evPercent) + '%</td><td>' + statusTag(s.status) + '</td></tr>';
    }).join('');
    $('opportunity-table').innerHTML = rows || '<tr><td colspan="6">' +
      empty('No markets to rank', state.error ? 'Connect an odds source or switch to demo mode.' :
        'No supported two-way quotes were returned for this league and market.') + '</td></tr>';
  }

  function renderSpotlight() {
    const signals = all();
    let signal = findSignal(state.selectedId);
    if (!signal) signal = signals.find(s => s.status === 'WATCH') || signals[0];
    if (!signal) {
      $('spotlight').innerHTML = empty('Awaiting a priced contract', 'Select a league and load the feed to inspect probabilities and audit gates.');
      return;
    }
    state.selectedId = signal.id;
    const issue = signal.reasons.length ? signal.reasons.join(' · ').replaceAll('_', ' ') : 'Minimum quantitative price gates passed';
    const model = signal.event.independentModel;
    const hasIndependent = model?.available === true && Number.isFinite(signal.eloBaselineProbability);
    const modelCompare = hasIndependent
      ? '<div class="model-spotlight"><div><span class="panel-kicker">INDEPENDENT NFL ELO</span><strong>' +
        pct(signal.eloBaselineProbability) + ' win probability</strong></div><div><span class="panel-kicker">MODEL vs OFFERED PRICE</span><strong>' +
        signed(signal.eloPriceEdgePoints) + ' pp · ' + signed(signal.eloIndicativeEvPercent) + '% theoretical EV</strong></div>' +
        '<p>2025 untouched holdout: ' + model.holdoutN + ' games · Brier ' + num(model.holdoutBrier,5) +
        '. No injury, confirmed-starter, weather or player-status adjustment. Research only.</p></div>'
      : '';
    $('spotlight').innerHTML = '<div class="spotlight-body"><div class="spotlight-head">' +
      statusTag(signal.status) + '<span class="faint-caption">QUALITY ' + signal.qualityScore + '/100</span></div>' +
      '<div class="spotlight-match">' + esc(eventLabel(signal.event)) + ' · ' + esc(when(signal.event.commenceTime)) + '</div>' +
      '<div class="spotlight-select">' + esc(signal.selection) + '</div>' +
      '<div class="spotlight-book">Best observed: <b>' + esc(signal.bookmaker) + '</b> <span class="odds-pill">' +
      esc(odds(signal.americanOdds)) + '</span></div><div class="spotlight-stats">' +
      '<div class="spotlight-stat"><label>Fair market P</label><strong>' + pct(signal.fairProbability) + '</strong></div>' +
      '<div class="spotlight-stat"><label>Offered implied P</label><strong>' + pct(signal.impliedProbability) + '</strong></div>' +
      '<div class="spotlight-stat"><label>Price edge</label><strong class="' + (signal.edgePoints > 0 ? 'positive' : 'negative') +
      '">' + signed(signal.edgePoints) + ' pp</strong></div>' +
      '<div class="spotlight-stat"><label>Indicative EV</label><strong class="' + (signal.evPercent > 0 ? 'positive' : 'negative') +
      '">' + signed(signal.evPercent) + '%</strong></div></div>' +
      modelCompare + '<div class="spotlight-explain"><b>Market-only quant assessment:</b> ' + esc(issue) +
      '. Baseline derived from ' + signal.comparatorBooks + ' other book(s) at the identical line. ' +
      'Reference quote age: ' + signal.quoteAgeSeconds + 's. ' +
      'Injury, weather and starting-lineup verification: unavailable. ' +
      'Half-time lean: not modeled.</div><div class="spotlight-actions">' +
      '<button type="button" class="outline-button" data-watch="' + esc(signal.id) + '">☆ ' +
      (isWatched(signal.id) ? 'Watching' : 'Add to watchlist') + '</button>' +
      '<button type="button" class="primary-button" data-paper="' + esc(signal.id) + '"' +
      (signal.paperStagingAuthorized === true && state.slate?.executionGate?.bettingAuthorized === true ? '' : ' disabled') + '>Paper staging locked · research only</button></div></div>';
  }

  function renderChart() {
    const events = state.slate?.events || [];
    const bars = events.map(event => {
      const arr = event.opportunities.filter(s => Number.isFinite(s.edgePoints));
      return { label: event.awayTeam + ' / ' + event.homeTeam,
        value: arr.length ? Math.max(0, ...arr.map(s => s.edgePoints)) : 0 };
    }).sort((a, b) => b.value - a.value).slice(0, 6);
    const max = Math.max(2, ...bars.map(x => x.value));
    $('edge-chart').innerHTML = bars.length ? bars.map(b =>
      '<div class="bar-chart-row"><span class="bar-name" title="' + esc(b.label) + '">' +
      esc(b.label) + '</span><progress class="edge-progress" max="100" value="' +
      Math.min(100, Math.max(0, b.value / max * 100)) + '"></progress><b class="bar-number">' +
      num(b.value) + 'pp</b></div>').join('') +
      '<p class="chart-note">Cross-book price advantage, not historical predictive accuracy. ' +
      'Each bar is calculated from the current selected market snapshot.</p>' :
      empty('Chart awaiting data', 'No price differences are available to graph.');
  }

  function renderGames() {
    const events = state.slate?.events || [];
    $('game-grid').innerHTML = events.map(event => {
      const top = event.topSignal;
      const projection = event.independentModel;
      return '<article class="game-card"><div class="game-head"><span>' + esc(sportLabels[state.sport]) +
        ' · ' + esc(when(event.commenceTime)) + '</span><span>' +
        (state.mode === 'demo' ? statusTag('DEMO') : (event.started ? 'IN PROGRESS / STARTED' : 'UPCOMING')) +
        '</span></div><div class="game-teams"><div class="game-team">' + esc(event.awayTeam) +
        '</div><span class="versus">VS</span><div class="game-team">' + esc(event.homeTeam) +
        '</div></div>' +
        (projection?.available ? '<div class="game-model"><span>INDEPENDENT ELO BASELINE</span><b>' +
          esc(event.homeTeam) + ' ' + pct(projection.homeWinProbability) +
          ' · ' + esc(event.awayTeam) + ' ' + pct(projection.awayWinProbability) +
          '</b><small>2025 holdout Brier ' + num(projection.holdoutBrier,5) + ' · no injury updates</small></div>' : '') +
        '<div class="game-bottom"><span>' + event.bookmakerCount + ' sportsbooks · '
        event.totalMarkets + ' matched contract(s)</span>' +
        (top ? '<button type="button" class="text-link" data-pick="' + esc(top.id) + '">Inspect ' +
          esc(signed(top.evPercent)) + '% price scenario (not a bet) ↗</button>' : '<span>No qualifying quotes</span>') + '</div></article>';
    }).join('') || empty('No upcoming games with listed odds', 'The provider may not have posted prices for this market or league yet.');
    if (state.mode === 'demo') $('scores').innerHTML = '<div class="notice">Demo scores are intentionally not generated. No fictitious final results are shown.</div>';
  }

  function renderSignals() {
    let signals = all();
    const query = state.search.trim().toLowerCase();
    if (query) signals = signals.filter(s =>
      [s.selection, s.bookmaker, s.event.homeTeam, s.event.awayTeam].some(v => String(v).toLowerCase().includes(query)));
    if (state.watchOnly) signals = signals.filter(s => s.status === 'WATCH');
    signals.sort((a, b) => {
      if (state.sort === 'quality') return b.qualityScore - a.qualityScore;
      if (state.sort === 'edge') return (b.edgePoints ?? -999) - (a.edgePoints ?? -999);
      if (state.sort === 'soon') return Date.parse(a.event.commenceTime) - Date.parse(b.event.commenceTime);
      return (b.evPercent ?? -999) - (a.evPercent ?? -999);
    });
    $('signal-grid').innerHTML = signals.map(s =>
      '<article class="signal-card ' + (state.selectedId === s.id ? 'focused' : '') +
      '"><div class="signal-card-top"><span class="signal-card-match">' + esc(eventLabel(s.event)) +
      '</span>' + statusTag(s.status) + '</div><h3>' + esc(s.selection) + '</h3>' +
      '<div class="signal-book">' + esc(s.bookmaker) + ' <span class="odds-pill">' +
      esc(odds(s.americanOdds)) + '</span> · ' + esc(s.contractLabel) + '</div>' +
      '<div class="signal-numbers"><div><label>FAIR P</label><strong>' + pct(s.fairProbability) +
      '</strong></div><div><label>EDGE</label><strong class="' + (s.edgePoints > 0 ? 'positive' : 'negative') + '">' +
      signed(s.edgePoints) + 'pp</strong></div><div><label>EV</label><strong class="' +
      (s.evPercent > 0 ? 'positive' : 'negative') + '">' + signed(s.evPercent) +
      '%</strong></div><div><label>QUALITY</label><strong>' + s.qualityScore + '</strong></div></div>' +
      '<div class="signal-footer"><span class="signal-meta">' + s.comparatorBooks +
      ' comparators · ' + s.quoteAgeSeconds + 's old · ' +
      (s.reasons.length ? esc(s.reasons[0].replaceAll('_', ' ')) : 'Price gates passed') +
      '</span><span class="signal-actions"><button class="small-button" type="button" data-pick="' + esc(s.id) +
      '">Inspect</button><button class="small-button" type="button" data-watch="' + esc(s.id) +
      '">' + (isWatched(s.id) ? '★ Saved' : '☆ Watch') +
      '</button><button class="small-button" type="button" data-paper="' + esc(s.id) + '"' +
      (s.paperStagingAuthorized === true && state.slate?.executionGate?.bettingAuthorized === true ? '' : ' disabled') + '>Paper locked</button></span></div></article>'
    ).join('') || empty('No matching signals', 'Try a different filter, sport or data mode.');
  }

  function isWatched(id) {
    const items = safeGet('betq-watch-v1', []);
    return Array.isArray(items) && items.includes(id);
  }
  function toggleWatch(id) {
    const current = safeGet('betq-watch-v1', []);
    const items = new Set(Array.isArray(current) ? current : []);
    if (items.has(id)) items.delete(id); else items.add(id);
    localStorage.setItem('betq-watch-v1', JSON.stringify([...items].slice(0, 100)));
    renderSignals(); renderSpotlight();
    toast(items.has(id) ? 'Signal added to watchlist on this device.' : 'Signal removed from watchlist.');
  }

  function stagePaper(id) {
    // Defense in depth: the server's final decision overrides market WATCH.
    if(state.slate?.agentRun?.mayWager !== true ||
       state.slate?.executionGate?.bettingAuthorized !== true)
      return toast('Automated paper staging locked: no validated model advantage. Prospective research is tracked separately.');
    const signal = findSignal(id);
    if(state.loading || state.slate?.sport!==state.sport || state.slate?.market!==state.market)
      return toast('Paper staging blocked: snapshot does not match current filters.');
    if (!signal || signal.paperStagingAuthorized !== true || signal.executionAuthorized !== true)
      return toast('Paper staging blocked by the central risk authority.');
    if (signal.event.started || Date.parse(signal.event.commenceTime) - Date.now() < 300000)
      return toast('Paper staging blocked: game started or kickoff imminent.');
    if (Date.now() - Date.parse(signal.lastUpdated) > 600000)
      return toast('Paper staging blocked: quote has become stale. Refresh first.');
    const openExposure = state.ledger.filter(t => t.status === 'OPEN').reduce((sum, t) => sum + t.stake, 0);
    const theoretical = Number(signal.theoreticalUnits) || 0;
    const stake = Number((state.bankroll * Math.min(state.maxRisk, theoretical) / 100).toFixed(2));
    if (stake < 0.01) return toast('Paper sizing too small; no ticket staged.');
    if (openExposure + stake > state.bankroll * 0.05)
      return toast('Paper portfolio exposure cap reached (5% of bankroll).');
    if (state.ledger.some(t => t.pickId === id && t.status === 'OPEN'))
      return toast('An open paper ticket already exists for this contract.');
    const ticket = {
      id: 'paper-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
      pickId: id, game: eventLabel(signal.event), selection: signal.selection,
      bookmaker: signal.bookmaker, odds: signal.americanOdds,
      decimalOdds: signal.decimalOdds, stake, status: 'OPEN', pnl: null,
      sourceMode: state.mode, createdAt: new Date().toISOString(),
      evAtEntry: signal.evPercent, baseline: signal.basis
    };
    state.ledger.unshift(ticket);
    saveLedger(); setTab('execution');
    toast('Paper-only ticket staged. No real bet was placed.');
  }

  function settlePaper(id, result) {
    const ticket = state.ledger.find(t => t.id === id);
    if (!ticket || ticket.status !== 'OPEN' || !['WIN', 'LOSS', 'PUSH', 'VOID'].includes(result)) return;
    ticket.status = result;
    ticket.settledAt = new Date().toISOString();
    ticket.pnl = result === 'WIN' ? Number((ticket.stake * (ticket.decimalOdds - 1)).toFixed(2))
      : result === 'LOSS' ? -ticket.stake : 0;
    ticket.manualSettlement = true;
    saveLedger(); renderExecution(); renderPricing();
    toast('Paper result marked ' + result + '. This result was not verified by a feed.');
  }


  function renderPricing() {
    const overview=$('pricing-overview'),result=$('pricing-calculation');
    if(!overview||!result)return;
    const seen=new Set();
    let stakeCents=0,netCents=0,graded=0,voids=0;
    for(const t of state.ledger){
      if(!t||typeof t.id!=='string'||seen.has(t.id))continue;
      seen.add(t.id);
      if(t.manualSettlement!==true)continue;
      if(t.status==='VOID'){voids++;continue;}
      if(!['WIN','LOSS','PUSH'].includes(t.status)||
        !Number.isFinite(t.stake)||t.stake<=0||!Number.isFinite(t.pnl))continue;
      stakeCents+=Math.round(t.stake*100);
      netCents+=Math.round(t.pnl*100);
      graded++;
    }
    const manualRoi=stakeCents>0?100*netCents/stakeCents:null;
    const verified=state.priceVerification;
    overview.innerHTML='<div class="metric-grid">'+
      metric('VERIFIED REAL-MONEY ROI','—','No authenticated transaction ledger','', '∅')+
      metric('VERIFIED CLOSING VALUE','—','No certified matched closing quotes','', '◇')+
      metric('LOCAL PAPER ROI',manualRoi===null?'—':signed(manualRoi,2)+'%',
        graded+' manually settled positions · not audited','violet','⌁')+
      metric('MANUAL PAPER NET',graded?usd(netCents/100):'—',
        'Risked '+usd(stakeCents/100)+' · '+voids+' void excluded','cyan','∑')+'</div>'+
      '<div class="notice info"><span>◇</span><p><b>Source verification: unavailable.</b> '+
      'These paper results are entered manually in this browser. No real-money ROI or '+
      'certified CLV is established. '+
      (verified?.reason?esc(verified.reason):
        'Trusted bookmaker transaction and closing quote feeds have not been attached.')+
      '</p></div>';
    const o=state.pricingResult;
    if(state.pricingError) {
      result.innerHTML='<div class="notice"><span>!</span><p>'+
        esc(state.pricingError)+'</p></div>';
    }else if(!o){
      result.innerHTML=empty('Illustrative comparison only',
        'Enter two American prices and an optional opposite-side close to calculate math. No bet or quote is recorded.');
    }else {
      result.innerHTML='<div class="pricing-result-grid">'+
        '<div><label>Entry decimal odds</label><strong>'+num(o.entryDecimal,4)+'</strong></div>'+
        '<div><label>Closing decimal odds</label><strong>'+num(o.closingDecimal,4)+'</strong></div>'+
        '<div><label>Raw price movement</label><strong class="'+
          (o.rawCLVPercent>=0?'positive':'negative')+'">'+signed(o.rawCLVPercent,2)+'%</strong></div>'+
        '<div><label>Implied probability change</label><strong>'+signed(o.impliedProbabilityMovePoints,2)+
          ' pp</strong></div>'+
        '<div><label>No-vig closing price proxy</label><strong>'+
          (o.noVigCLVPercent===null?'—':signed(o.noVigCLVPercent,2)+'%')+'</strong></div>'+
        '<div><label>Hypothetical result P/L</label><strong>'+
          (o.settlement?.netProfit===null?'Unsettled':usd(o.settlement?.netProfit))+
          '</strong></div></div>'+
        '<p class="pricing-disclaimer">These are <b>illustrative calculations, not verified ROI or CLV</b>. '+
        'Closing quotes and matched real-money fills have not been authenticated. '+
        'The no-vig proxy removes margin only when both closing prices are supplied.</p>';
    }
  }

  async function loadPriceVerification(){
    try{state.priceVerification=await requestJSON('/api/price/verification');}
    catch{state.priceVerification={verifiedROI:null,verifiedCLV:null};}
    renderPricing();
  }

  async function calculateIllustrativePricing(){
    const params=new URLSearchParams({
      entry:$('pricing-entry').value,
      close:$('pricing-close').value,
      stake:$('pricing-stake').value,
      result:$('pricing-result').value
    });
    if($('pricing-opposite').value.trim()!=='')
      params.set('closingOpposite',$('pricing-opposite').value);
    try{
      state.pricingResult=await requestJSON('/api/price/illustration?'+params.toString());
      state.pricingError=null;
    }catch(err){
      state.pricingResult=null;state.pricingError=err.message||'Invalid hypothetical price pair.';
    }
    renderPricing();
  }

  function renderExecution() {
    const open = state.ledger.filter(t => t.status === 'OPEN');
    const closed = state.ledger.filter(t => t.status !== 'OPEN');
    const exposure = open.reduce((sum, t) => sum + t.stake, 0);
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const ratio = Math.min(100, exposure / Math.max(1, state.bankroll * 0.05) * 100);
    const tickets = state.ledger.slice(0, 60).map(ticket =>
      '<tr><td><strong>' + esc(ticket.selection) + '</strong><br><small>' +
      esc(ticket.game) + '</small></td><td>' + esc(odds(ticket.odds)) +
      '<br><small>' + esc(ticket.bookmaker) + '</small></td><td>' + usd(ticket.stake) +
      '</td><td>' + esc(ticket.sourceMode.toUpperCase()) + '</td><td>' +
      esc(ticket.status) + '</td><td>' + (ticket.pnl === null ? '—' : usd(ticket.pnl)) +
      '</td><td>' + (ticket.status === 'OPEN' ?
        '<button type="button" class="small-button" data-settle="' + esc(ticket.id) +
        '" data-result="WIN">W</button> <button type="button" class="small-button" data-settle="' +
        esc(ticket.id) + '" data-result="LOSS">L</button> <button type="button" class="small-button" data-settle="' +
        esc(ticket.id) + '" data-result="PUSH">Push</button> <button type="button" class="small-button" data-settle="' +
        esc(ticket.id) + '" data-result="VOID">Void</button>' : '<small>MANUAL</small>') + '</td></tr>'
    ).join('');
    $('execution-view').innerHTML = '<div class="execution-grid">' +
      '<article class="panel execution-card"><div class="label-sm">PAPER BANKROLL</div><div class="big-stat">' +
      usd(state.bankroll) + '</div><div class="risk-details">Configured maximum stake: ' + num(state.maxRisk) +
      '% per paper ticket · 5% portfolio exposure cap.</div><progress class="risk-progress" max="100" value="' +
      ratio + '"></progress><div class="risk-details">Open exposure: ' + usd(exposure) + ' of ' +
      usd(state.bankroll * 0.05) + ' cap · Worst case if all open tickets lose: -' +
      usd(exposure) + '</div></article>' +
      '<article class="panel execution-card"><div class="label-sm">PAPER LEDGER / MANUALLY SETTLED</div><div class="big-stat ' +
      (totalPnl >= 0 ? 'positive' : 'negative') + '">' + usd(totalPnl) +
      '</div><div class="risk-details">' + state.ledger.length + ' historical paper tickets · ' +
      open.length + ' open · ' + closed.length + ' manually settled.<br>W/L/V outcomes are user-entered and not performance-verified.</div></article>' +
      '</div><section class="panel top-gap"><div class="panel-head"><div><span class="panel-kicker">PAPER TRADING ONLY</span><h3>Position ledger</h3></div><span class="danger-inline">NO SPORTSBOOK ORDERS</span></div>' +
      '<div class="table-scroll"><table class="execution-table"><thead><tr><th>CONTRACT</th><th>OBSERVED QUOTE</th><th>STAKE</th><th>MODE</th><th>STATUS</th><th>P/L</th><th>MANUAL RESULT</th></tr></thead><tbody>' +
      (tickets || '<tr><td colspan="7">' +
      empty('No paper tickets yet', 'Open the Signal Scanner and stage a WATCH contract to explore paper risk. No real bets will be placed.') +
      '</td></tr>') + '</tbody></table></div></section>' +
      '<div class="notice info top-gap"><span>◇</span><p>Paper results are manually entered, not verified against official results. ' +
      'The baseline is market consensus, not an independent predictive model. No responsible real-money sizing can be inferred from these simulations.</p></div>';
  }

  function auditRow(title, detail, status, good) {
    return '<div class="audit-item"><div><b>' + esc(title) + '</b><small>' +
      esc(detail) + '</small></div><span class="status-tag ' + (good ? 'watch' : 'pass') +
      '">' + esc(status) + '</span></div>';
  }

  function renderModel() {
    const root = $('model-view');
    if (!root) return;
    const report = state.nflModel;
    if (!report) { root.innerHTML = empty('Loading independent model', 'Reading NFL outcome model provenance and 2025 holdout evaluation…'); return; }
    if (!report.available) {
      root.innerHTML = empty('NFL model not available', 'The training artifact is missing, too old, or did not satisfy validation thresholds. Reason: ' +
        (report.reason || 'unknown') + '. Market-only odds scanning remains available.');
      return;
    }
    const h = report.holdout, c = report.calibration, t = report.tuning;
    const stats = '<div class="metric-grid">' +
      metric('2025 HOLDOUT GAMES', String(h.n), 'Untouched test set', '', '◇') +
      metric('WINNER ACCURACY', num(h.accuracy * 100, 2) + '%', '2025 pregame outcomes', 'lime', '⌁') +
      metric('2025 BRIER', num(h.brier, 5), 'Lower is better · 0.25 coin flip', 'violet', '∑') +
      metric('CALIBRATION ERROR', num(h.ece * 100, 2) + '%', '2025 10-bin ECE', 'cyan', '◌') + '</div>';
    const protocol = '<section class="panel"><div class="panel-head"><div><span class="panel-kicker">NO FUTURE DATA LEAKAGE</span>' +
      '<h3>Training & backtest</h3></div><span class="status-tag watch">BASELINE BACKTESTED</span></div>' +
      '<div class="model-audit"><div><span>Parameter tuning</span><strong>2018–2022</strong></div>' +
      '<div><span>Calibration</span><strong>2023–2024</strong></div>' +
      '<div><span>Untouched evaluation</span><strong>2025</strong></div>' +
      '<div><span>2018–22 tuning Brier</span><strong>' + num(t.brier,5) + '</strong></div>' +
      '<div><span>2023–24 calibration Brier</span><strong>' + num(c.brier,5) + '</strong></div>' +
      '<div><span>2025 test Brier</span><strong>' + num(h.brier,5) + '</strong></div>' +
      '<div><span>2025 log loss</span><strong>' + num(h.logLoss,5) + '</strong></div>' +
      '<div><span>2025 calibration ECE</span><strong>' + pct(h.ece,2) + '</strong></div>' +
      '<div><span>Completed historical games</span><strong>' + report.completedGames + '</strong></div>' +
      '<div><span>Results processed through</span><strong>' + esc(report.lastGameDate) + '</strong></div></div>' +
      '<p class="model-disclaimer">Source: nflverse/nfldata (CC BY 4.0). Elo estimates are independent of sportsbook prices ' +
      'and use only prior game outcomes. They do not incorporate live injuries, starting quarterbacks, ' +
      'travel, weather or play-by-play analytics. Backtested accuracy does not prove a positive betting ROI.</p></section>';
    const matches = (state.slate?.events || []).filter(x => x.independentModel?.available);
    const display = matches.map(ev => {
      const m = ev.independentModel;
      const priced = ev.opportunities.filter(x => Number.isFinite(x.eloIndicativeEvPercent));
      const candidate = [...priced].sort((a,b) => b.eloIndicativeEvPercent - a.eloIndicativeEvPercent)[0];
      return '<article class="model-match"><div class="model-match-top"><b>' + esc(eventLabel(ev)) +
        '</b><span>' + esc(when(ev.commenceTime)) + '</span></div>' +
        '<div class="model-match-sides"><div><span>' + esc(ev.homeTeam) + ' · HOME</span><strong>' +
        pct(m.homeWinProbability) + '</strong><progress max="100" value="' +
        (m.homeWinProbability * 100).toFixed(2) + '"></progress></div><div><span>' +
        esc(ev.awayTeam) + ' · AWAY</span><strong>' + pct(m.awayWinProbability) +
        '</strong><progress max="100" value="' + (m.awayWinProbability * 100).toFixed(2) +
        '"></progress></div></div>' +
        (candidate ? '<div class="model-match-footer"><span>Largest Elo vs book discrepancy</span><b>' +
          esc(candidate.selection) + ' · ' + esc(candidate.bookmaker) + ' ' +
          esc(odds(candidate.americanOdds)) + ' · ' + signed(candidate.eloIndicativeEvPercent) +
          '% hypothetical EV</b></div>' : '') +
        '<p>Research-only baseline. Confirm injuries, starting lineups and current availability independently.</p></article>';
    }).join('');
    const forecastPanel = '<section class="panel"><div class="panel-head"><div><span class="panel-kicker">CURRENT NFL SLATE</span>' +
      '<h3>Elo projections vs live markets</h3></div><span class="header-mini-icon">⌁</span></div>' +
      ((state.sport !== 'americanfootball_nfl' || state.market !== 'h2h' || state.mode === 'demo')
        ? empty('Select NFL · Moneyline · Live', 'Independent NFL Elo predictions are restricted to current, real NFL moneyline games. No other league or demo probability is invented.')
        : display ? '<div class="model-game-list">' + display + '</div>' :
          empty('No eligible upcoming NFL games', 'If there are no listed pregame games or quotes, no projections are issued.')) +
      '</section>';
    root.innerHTML = stats + '<div class="model-columns">' + forecastPanel + protocol + '</div>' +
      '<div class="notice info model-caution"><span>◇</span><p>Model forecasts are a separately backtested prior, ' +
      'not the consensus price scanner and not verified betting picks. MARKET WATCH/PASS labels do not mean ' +
      'the model found a profitable advantage.</p></div>';
  }



  function renderIntelligence() {
    const root=$('intelligence-view');
    if(!root)return;
    const r=state.efficiency,injSource=state.injurySource;
    if(!r||!injSource){
      root.innerHTML=empty('Loading source-backed NFL intelligence',
        'Reading independent EPA challenger evaluation and public weekly injury report provenance…');
      return;
    }
    const holdout=r.holdout,eligible=r.available===true,good=eligible&&
      r.promotableInHistoricalHoldout===true;
    const modelHead='<div class="section-heading nfl4-subtitle"><div>'+
      '<div class="eyebrow subtle">04B / FEATURE INTELLIGENCE</div>'+
      '<h2>EPA challenger & roster watch</h2></div>'+
      '<span class="tag-neutral">RESEARCH ONLY · NO AUTO-PROMOTION</span></div>';
    const model=eligible ?
      '<div class="nfl4-three-metrics">'+
        '<div><label>2025 ELO BRIER</label><strong>'+
          num(holdout.elo?.brier,5)+'</strong></div>'+
        '<div><label>EPA CHALLENGER BRIER</label><strong class="'+
          (good?'positive':'')+'">'+num(holdout.challenger?.brier,5)+'</strong></div>'+
        '<div><label>PAIRED IMPROVEMENT</label><strong>'+
          signed(holdout.deltaBrier,5)+'</strong></div></div>'+
        '<div class="nfl4-intel-body"><p><b>Untouched 2025 test:</b> '+
        esc(String(holdout.challenger?.n||0))+' completed games. EPA/success/rest challenger '+
        (good?'passed its predefined historical proper-score gate.':'did not pass the historical promotion gate.')+
        ' The paired 95% bootstrap interval for baseline minus challenger Brier is '+
        signed(holdout.confidence95?.lower,5)+' to '+
        signed(holdout.confidence95?.upper,5)+
        '. Games can be correlated within weeks; an individual-game interval may overstate confidence. This is not forward betting ROI or proof of an execution edge.</p>'+ 
        '<p>Feature source: nflverse play-by-play, '+esc(r.sourceManifest?.sourceLastCompletedGame||'date unknown')+
        ' through the most recent processed game · '+esc(String(r.coverage?.featureReadyGames||0))+
        ' lagged games evaluated. Current model selection is still Elo.</p>'+
        '</div>' :
      '<div class="nfl4-intel-body"><p><b>Challenger unavailable.</b> '+
      esc(r.reason||'Feature model not yet published')+
      '. Elo remains the source of the published pregame baseline.</p></div>';
    const injuryStatus=injSource.available ?
      '<p><b>Injury source:</b> nflverse weekly reports · last published '+
       esc(when(injSource.sourceUpdatedAt))+' · '+
       esc(String(injSource.reportCount||0))+' team/week reports. '+
       (injSource.playerTimestampAvailable ?
         'Individual player update times reported.' :
         'No individual player update timestamps in the current CSV; source file vintage only.')+
       '</p>' :
      '<p><b>Injury source unavailable or stale.</b> Reported injuries and starter status are not assumed healthy. '+
       esc(injSource.reason||'No fresh data')+'</p>';
    const caution='<p class="nfl4-caution">Reported QB names are not confirmed starters. This build does not '+
      'claim a QB injury adjustment or change betting recommendations automatically. '+
      'EPA is computed only from previously completed games.</p>';
    const cards=(state.mode==='live'&&state.sport==='americanfootball_nfl'&&
      state.market==='h2h'?(state.slate?.events||[]):[])
      .filter(e=>!e.started).slice(0,20).map(e=>{
        const m=e.efficiencyChallenger,inj=e.injuryContext;
        const h=inj?.home,a=inj?.away;
        const source=inj?.available===true;
        const qbs=x=>x?.reportedQBs?.length?
          x.reportedQBs.map(p=>esc(p.player)+' ('+esc(p.status)+')').join('; ') :
          'No QB listing — starter still unverified';
        const injuryInfo=source ?
          '<div class="nfl4-injury-row"><div><span>'+esc(e.homeTeam)+
            ' report</span><b>'+(h?.reported?String(h.count)+' flagged':'No matching week report')+
            '</b><small>'+qbs(h)+'</small></div><div><span>'+esc(e.awayTeam)+
            ' report</span><b>'+(a?.reported?String(a.count)+' flagged':'No matching week report')+
            '</b><small>'+qbs(a)+'</small></div></div>' :
          '<p class="nfl4-warning">Injury week or source is not verified: '+
            esc(inj?.reason||'Unavailable')+'. No availability assumptions applied.</p>';
        const modelInfo=m?.available?
          '<div class="nfl4-prob-row"><div><span>BASELINE ELO · HOME</span><strong>'+
            pct(m.baselineEloProbability)+'</strong></div><div><span>EPA CHALLENGER · HOME</span>'+
            '<strong>'+pct(m.homeWinProbability)+'</strong></div><div>'+
            '<span>CHALLENGER DELTA</span><strong>'+
            signed((m.homeWinProbability-m.baselineEloProbability)*100,2)+'pp</strong></div></div>'+
          '<div class="nfl4-feature-row">Offensive EPA/play: '+esc(e.homeTeam)+' '+
             num(m.inputs.homeOffEPA,3)+' vs '+esc(e.awayTeam)+' '+
             num(m.inputs.awayOffEPA,3)+' · Allowed EPA/play: '+
             num(m.inputs.homeDefAllowedEPA,3)+' / '+num(m.inputs.awayDefAllowedEPA,3)+
             ' · Rest differential: '+signed(m.inputs.restDaysDifferential,0)+' days</div>' :
          '<p class="nfl4-warning">EPA challenger suppressed: '+
          esc(m?.reason||'Not enough prior completed data')+'. Elo baseline remains unchanged.</p>';
        return '<article class="panel nfl4-match">'+
          '<div class="panel-head"><div><span class="panel-kicker">WEEKLY NFL INTELLIGENCE</span>'+
          '<h3>'+esc(eventLabel(e))+'</h3></div>'+
          '<span class="faint-caption">'+esc(when(e.commenceTime))+'</span></div>'+
          '<div class="nfl4-match-content">'+modelInfo+injuryInfo+'</div>'+
          '</article>';
      }).join('');
    root.innerHTML=modelHead+
      '<div class="nfl4-columns"><section class="panel">'+
        '<div class="panel-head"><div><span class="panel-kicker">LAGGED EPA / SUCCESS / REST</span>'+
        '<h3>Independent challenger evaluation</h3></div><span class="status-tag '+
        (good?'watch':'pass')+'">'+(good?'HISTORICAL CHECK ONLY':'UNPROMOTED')+
        '</span></div>'+model+'</section>'+
      '<section class="panel"><div class="panel-head"><div><span class="panel-kicker">REPORT SOURCE GOVERNANCE</span>'+
      '<h3>Reported injuries ≠ confirmed starters</h3></div></div>'+
      '<div class="nfl4-intel-body">'+injuryStatus+caution+'</div></section></div>'+
      '<div class="section-heading nfl4-subtitle"><div><div class="eyebrow subtle">SOURCE-ALIGNED / UPCOMING</div>'+
      '<h2>Game-level research comparisons</h2></div>'+
      '<span class="faint-caption">NO WAGERING EXECUTION</span></div>'+
      '<div class="nfl4-game-grid">'+
        (cards||empty('Select live NFL moneylines','The current league and market do not have eligible future NFL game comparisons.'))+
      '</div>';
  }

  // A cached or older API summary must not restore legacy outcome claims.
  function evidenceScoringView(e) {
    const count=n=>Number.isInteger(n)&&n>=0;
    const keys=['prospectiveGames','settledGames','pairedMarketGames','pairedChallengerSettled',
      'sourceCorroboratedSettledGames','sourceUncorroboratedSettledGames',
      'sourceCorroboratedMarketGames','sourceCorroboratedChallengerGames'];
    const valid=e?.outcomeScoringPolicy==='SOURCE_CORROBORATED_SETTLEMENT_V1'&&
      e.sourceIndependenceVerified===false&&e.minimumScoredSample===30&&
      e.researchOnly===true&&e.noWagering===true&&e.marketBeatingEdgeEstablished===false&&
      e.realizedROI===null&&e.verifiedCLV===null&&keys.every(key=>count(e[key]))&&
      e.sourceCorroboratedSettledGames+e.sourceUncorroboratedSettledGames===e.settledGames&&
      e.settledGames<=e.prospectiveGames&&e.pairedMarketGames<=e.settledGames&&
      e.pairedChallengerSettled<=e.settledGames&&
      e.status===(e.sourceCorroboratedSettledGames>=30?'FORWARD_SAMPLE_AVAILABLE':'COLLECTING_FORWARD_EVIDENCE')&&
      e.sourceCorroboratedMarketGames<=e.sourceCorroboratedSettledGames&&
      e.sourceCorroboratedMarketGames<=e.pairedMarketGames&&
      e.sourceCorroboratedChallengerGames<=e.sourceCorroboratedSettledGames&&
      e.sourceCorroboratedChallengerGames<=e.pairedChallengerSettled;
    const sample=valid?e.sourceCorroboratedSettledGames:0;
    const market=valid?e.sourceCorroboratedMarketGames:0;
    const challenger=valid?e.sourceCorroboratedChallengerGames:0;
    return {valid,sample,market,challenger,
      forward:sample>=30&&e.forwardMetrics?.n===sample&&
        Number.isFinite(e.forwardMetrics.brier)&&e.forwardMetrics.brier>=0&&e.forwardMetrics.brier<=1?e.forwardMetrics:null,
      benchmark:market>=30&&e.marketComparison?.n===market?e.marketComparison:null,
      comparison:challenger>=30&&e.challengerForwardComparison?.n===challenger?e.challengerForwardComparison:null};
  }

  function renderEvidence() {
    const root = $('evidence-view');
    if (!root) return;
    const e = state.evidence;
    if (!e) {
      root.innerHTML = empty('Loading forward validation', 'Checking prospectively frozen predictions and final results…');
      return;
    }
    if (e.error || e.schema !== 1) {
      root.innerHTML = empty('Evidence service unavailable', 'The evidence API has not finished deploying. Historical NFL Prediction Lab remains available.');
      return;
    }
    const scoring = evidenceScoringView(e);
    const sample = scoring.sample;
    const recorded = Math.max(0, Number(e.settledGames) || 0);
    const progress = Math.min(30, sample);
    const qualified = Boolean(scoring.forward);
    const positive = scoring.benchmark?.consensusMinusModelBrier > 0;
    const stats = '<div class="metric-grid">' +
      metric('PREGAME FORECASTS', String(e.prospectiveGames || 0), 'Unique frozen before kickoff', 'cyan', '◫') +
      metric('RESULTS RECORDED', String(recorded), sample + ' source-corroborated · ties excluded', 'lime', '✓') +
      metric('SAME-TIME MARKET PAIRS', String(scoring.market), 'Source-corroborated outcome pairs', 'violet', '⌁') +
      metric('FORWARD BRIER SCORE', qualified ? num(e.forwardMetrics.brier, 5) : '—',
        qualified ? 'Source-corroborated outcomes only' : 'Requires 30 source-corroborated games', '', '◇') +
      '</div>';
    const gate = '<section class="panel evidence-collection"><div class="panel-head"><div>' +
      '<span class="panel-kicker">PROSPECTIVE EVIDENCE GATE</span><h3>' +
      (qualified ? 'Forward results accumulating' : 'Collecting real outcomes') +
      '</h3></div><span class="status-tag ' + (qualified ? 'watch' : 'pass') + '">' +
      (qualified ? 'SAMPLE AVAILABLE' : 'NOT ENOUGH GAMES') + '</span></div>' +
      '<div class="evidence-body"><p>Every forecast is timestamped before kickoff, retained without rewriting, then matched to a subsequent nflverse final score. ' +
      'Recorded scores alone do not qualify for performance reporting. Matching source receipts are required; upstream source independence is not established.</p>' +
      '<div class="evidence-progress-head"><b>' + sample + ' of 30 source-corroborated games</b>' +
      '<span>' + e.pendingGames + ' still pending</span></div>' +
      '<progress class="evidence-meter" max="30" value="' + progress + '"></progress>' +
      (qualified ? '<div class="evidence-performance"><div><span>Forward winner accuracy</span><strong>' +
        pct(e.forwardMetrics.winnerAccuracy, 2) + '</strong></div><div><span>Forward log loss</span><strong>' +
        num(e.forwardMetrics.logLoss, 5) + '</strong></div></div>' :
        '<p class="evidence-warning">Winner accuracy, model advantage and any performance claims stay withheld until at least 30 source-corroborated games are available. ' +
        'Thirty games is an initial reporting threshold, not sufficient to prove statistical or financial superiority.</p>') +
      '</div></section>';
    const mc = scoring.benchmark;
    const benchmark = '<section class="panel"><div class="panel-head"><div>' +
      '<span class="panel-kicker">PAIRED MARKET BENCHMARK</span><h3>Elo vs sportsbook consensus</h3></div>' +
      '<span class="header-mini-icon">≋</span></div>' +
      (mc ? '<div class="evidence-body"><p>Same pregame snapshot and same finalized games: <b>' +
        mc.n + ' paired forecasts</b>.</p><div class="evidence-performance"><div><span>Model Brier</span><strong>' +
        num(mc.modelBrier, 5) + '</strong></div><div><span>Market Brier</span><strong>' +
        num(mc.consensusBrier, 5) + '</strong></div></div>' +
        '<div class="evidence-performance"><div><span>Market minus model Brier</span><strong class="' +
        (positive ? 'positive' : 'negative') + '">' + signed(mc.consensusMinusModelBrier, 5) +
        '</strong></div><div><span>95% bootstrap interval</span><strong>' +
        signed(mc.confidence95?.lower, 5) + ' to ' + signed(mc.confidence95?.upper, 5) +
        '</strong></div></div><p>Lower Brier is better. A positive difference favors the model on this sample; ' +
        'it is not proof of a profitable betting strategy or true closing-line value.</p></div>' :
        empty('Market comparison not yet reportable',
          'At least 30 source-corroborated NFL results must match both frozen model probabilities and the same-time, de-vigged multi-book market reference.')) +
      '</section>';
    const dates = (e.pendingPreview || []).map(x =>
      '<div class="evidence-row"><div><strong>' + esc(x.away) + ' @ ' + esc(x.home) +
      '</strong><small>' + esc(x.gameDate) + ' · frozen ' + esc(when(x.capturedAt)) +
      '</small></div><div class="evidence-numbers"><b>' +
      pct(x.modelHomeProbability) + '</b><small>Market: ' +
      (Number.isFinite(x.marketHomeProbability) ? pct(x.marketHomeProbability) : 'unavailable') +
      '</small></div></div>').join('');
    const recent = (e.recentResults || []).map(x =>
      '<div class="evidence-row"><div><strong>' + esc(x.away) + ' @ ' + esc(x.home) +
      '</strong><small>' + esc(x.gameDate) + ' · final ' + esc(x.score) +
      ' · ' + esc(x.result) + ' · ' + (scoring.valid && x.sourceCorroborated === true ? 'source-corroborated' : 'corroboration not established') + '</small></div><div class="evidence-numbers"><b>' +
      pct(x.modelHomeProbability) + '</b><small>Brier: ' +
      (scoring.valid && x.sourceCorroborated === true && Number.isFinite(x.brier) ? num(x.brier, 4) : 'withheld') +
      '</small></div></div>').join('');
    const ledger = '<section class="panel"><div class="panel-head"><div>' +
      '<span class="panel-kicker">IMMUTABLE FORECAST JOURNAL</span><h3>Pending game evidence</h3></div>' +
      '<span class="faint-caption">HOME TEAM MODEL P</span></div>' +
      (dates ? '<div class="evidence-list">' + dates + '</div>' :
        empty('No pending tracked games', 'The scheduled collector has not captured eligible future NFL games yet.')) +
      '</section><section class="panel"><div class="panel-head"><div>' +
      '<span class="panel-kicker">SOURCE-ALIGNED RESULTS</span><h3>Recorded forecast results</h3></div>' +
      '<span class="faint-caption">HOME TEAM MODEL P</span></div>' +
      (recent ? '<div class="evidence-list">' + recent + '</div>' :
        empty('No completed forward forecasts yet', 'Results appear here after previously captured games are finalized in nflverse schedules.')) +
      '</section>';
    const cf=scoring.comparison;
    const challengerBlock='<section class="panel evidence-challenger"><div class="panel-head">'+
      '<div><span class="panel-kicker">EPA CHALLENGER / FROZEN PREGAME</span>'+
      '<h3>Prospective Elo vs EPA comparison</h3></div>'+
      '<span class="status-tag '+(cf?'watch':'pass')+'">'+
      (cf?'30+ FINALS':'COLLECTING')+'</span></div>'+
      '<div class="evidence-body"><p><b>'+
      esc(String(e.prospectiveChallengerGames||0))+
      ' future games with an independent EPA challenger frozen before kickoff.</b> '+
      esc(String(scoring.challenger))+
      ' matching games have source-corroborated, non-tied outcomes. '+
      'These forecasts are separate from the historical 2025 backtest.</p>'+
      (cf?'<div class="evidence-performance"><div><span>Prospective Elo Brier</span><strong>'+
        num(cf.baselineBrier,5)+'</strong></div><div><span>Prospective EPA Brier</span>'+
        '<strong>'+num(cf.challengerBrier,5)+'</strong></div></div>'+
        '<p>Paired improvement (Elo minus challenger): '+
        signed(cf.baselineMinusChallengerBrier,5)+
        ' · 95% interval '+signed(cf.confidence95?.lower,5)+' to '+
        signed(cf.confidence95?.upper,5)+
        '. This is probability scoring only, not a verified betting return.</p>' :
        '<div class="evidence-progress-head"><b>'+
        esc(String(scoring.challenger))+
        ' / 30 source-corroborated paired games</b><span>No retrospective backfill</span></div>'+
        '<progress class="evidence-meter" max="30" value="'+
        Math.min(30,Math.max(0,scoring.challenger))+
        '"></progress><p>Scores remain hidden until a minimum 30 challenger '+
        'forecasts were frozen and their results subsequently source-corroborated.</p>')+
      '</div></section>';
    const publication=e.publication;
    const sourceNotice=publication?.source==='PUBLIC_JOURNAL'?
      'Existing public journal last read successfully: '+esc(when(publication.lastSuccessfulFetchAt))+'. ':
      publication?.source==='BUNDLED_JOURNAL'?'Using the bundled evidence journal. ':'';
    const refreshNotice=publication?.lastError?
      'The latest journal refresh failed or did not pass integrity checks; retained evidence is shown. ':'';
    const captureNotice=publication?.latestSnapshotAt?
      'Newest recorded forecast capture: '+esc(when(publication.latestSnapshotAt))+'. ':'';
    root.innerHTML = stats + '<div class="evidence-columns">' + gate + benchmark + '</div>' +
      challengerBlock +
      '<div class="evidence-columns evidence-lists">' + ledger + '</div>' +
      '<div class="notice info evidence-footer"><span>◇</span><p><b>Auditable, not promotional.</b> ' +
      'No verified closing-line value, no real-money ROI, no betting orders, and no presumed model advantage. ' +
      'The historical 2025 backtest is not included in this prospective cohort. ' +
      'Scores come from community-maintained nflverse schedules. '+sourceNotice+refreshNotice+captureNotice+
      'Summary calculated: '+esc(when(e.generatedAt))+'. Source publication time is not verified.</p></div>';
  }

  function renderAudit() {
    const s = state.slate;
    const q = s?.quota;
    const rows = [
      auditRow('Source provenance', s ? s.source + ' · received ' + when(s.receivedAt) :
        'No source snapshot loaded', state.mode === 'demo' ? 'DEMO' : s ? 'API' : 'MISSING', Boolean(s)),
      auditRow('Two-way vig removal', 'Per-book normalization before consensus aggregation', 'ACTIVE', true),
      auditRow('Leave-one-book-out baseline', 'Candidate book excluded from fair-price estimate', 'ACTIVE', true),
      auditRow('Exact line matching', 'Spreads and totals compared only at identical points', 'ACTIVE', true),
      auditRow('Quote freshness gate', 'Old quotes excluded; no stale execution labels', 'ACTIVE', true),
      auditRow('NFL independent outcome model',
        state.nflModel?.available ? 'NFL Elo historical outcomes; 2025 holdout Brier ' +
          num(state.nflModel.holdout.brier,5) + '; injury/starting QB adjustment unavailable' :
          'No current source-verified, backtested NFL model available',
        state.nflModel?.available ? 'RESEARCH' : 'UNAVAILABLE', Boolean(state.nflModel?.available)),
      auditRow('Prospective outcome tracking',
        state.evidence ? String(state.evidence.prospectiveGames) + ' games frozen pregame · ' +
          String(state.evidence.settledGames) + ' results recorded · ' +
          String(evidenceScoringView(state.evidence).sample) + ' source-corroborated for scoring' :
          'Evidence journal not yet available',
        Boolean(evidenceScoringView(state.evidence).forward) ? 'SAMPLE READY' : 'COLLECTING',
        Boolean(evidenceScoringView(state.evidence).forward)),
      auditRow('EPA/success/rest independent challenger',
        state.efficiency?.available ? '2025 holdout baseline Brier '+
          num(state.efficiency.holdout?.elo?.brier,5)+' versus feature Brier '+
          num(state.efficiency.holdout?.challenger?.brier,5)+
          '. Not automatically promoted.' : 'Research challenger not available or source stale',
        state.efficiency?.available ? 'RESEARCH' : 'UNAVAILABLE', Boolean(state.efficiency?.available)),
      auditRow('NFL injury report provenance',
        state.injurySource?.available ?
          'Community report as-of '+when(state.injurySource.sourceUpdatedAt)+
          '; player-level update timestamps '+(state.injurySource.playerTimestampAvailable?'present':'not provided') :
          'Current injury source unavailable or stale',
        state.injurySource?.available?'SOURCE LOADED':'UNVERIFIED',
        Boolean(state.injurySource?.available)),
      auditRow('Real-money ROI & certified closing lines',
        'No authenticated filled wagers, independently graded settlements or full matched closing price history',
        'NOT VERIFIED',false),
      auditRow('Starting QB and injury effect on model',
        'No verified starting quarterback decisions. Injury reports do not alter probabilities.',
        'NOT MODELED',false),
      auditRow('Weather and venue conditions', 'Not integrated. Must be verified independently.', 'NOT VERIFIED', false),
      auditRow('First half / halftime model', 'Not supplied by the three featured markets endpoint', 'NOT MODELED', false),
      auditRow('Real money order execution', 'Intentionally disabled; paper records are local only', 'OFFLINE', false)
    ];
    $('audit-view').innerHTML = '<div class="audit-grid">' +
      '<article class="panel"><div class="panel-head"><div><span class="panel-kicker">PROVENANCE & METHODS</span><h3>Quant pipeline</h3></div></div><div class="audit-rows">' +
      rows.slice(0, 5).join('') + '</div></article>' +
      '<article class="panel"><div class="panel-head"><div><span class="panel-kicker">INTEGRITY CHECKS</span><h3>Unverified capabilities</h3></div></div><div class="audit-rows">' +
      rows.slice(5).join('') + '</div></article>' +
      '<article class="panel audit-note"><h3>Market snapshot</h3><p>League: ' + esc(sportLabels[state.sport]) +
      ' · market: ' + esc(marketLabels[state.market]) + ' · mode: ' + esc(state.mode.toUpperCase()) +
      '</p><p>Last received: ' + esc(s ? when(s.receivedAt) : 'None') +
      ' · source cache: ' + (s?.cacheHit ? 'HIT' : 'MISS / NO DATA') +
      ' · API credits remaining: ' + (q?.remaining ?? 'not reported') +
      '</p><p>Books required for WATCH: best-price offer plus at least two independent comparator books at the same line. ' +
      'Price signals are not outcome predictions; apparent positive EV can disappear after true model calibration.</p></article>' +
      '<article class="panel audit-note"><h3>Audit limitations</h3><p>A quality score measures feed agreement, recency and sample depth—not ' +
      'probability the pick will win. A WATCH means only that a cross-book quotation is worth investigating.</p>' +
      '<p>Before real-world use: connect confirmed injuries and weather, independently fit and backtest probabilities, ' +
      'track closing-line value, test calibration, handle live/in-play markets separately, and independently verify all final scores.</p></article>' +
      '</div>';
  }

  function syncSettings() {
    $('bankroll').value = String(state.bankroll);
    $('maxrisk').value = String(state.maxRisk);
  }
  function saveSettings() {
    const bankroll = Number($('bankroll').value);
    const maxRisk = Number($('maxrisk').value);
    if (!Number.isFinite(bankroll) || bankroll < 10 || bankroll > 10000000)
      return toast('Paper bankroll must be between $10 and $10,000,000.');
    if (!Number.isFinite(maxRisk) || maxRisk < 0.1 || maxRisk > 1)
      return toast('Max paper stake must be between 0.1% and 1%.');
    state.bankroll = bankroll; state.maxRisk = maxRisk;
    persist(); renderExecution(); toast('Local paper risk preferences updated.');
  }

  function render() {
    renderFilters(); renderFeed(); renderBanner(); renderMetrics(); renderAgentRun();
    renderOpportunities(); renderSpotlight(); renderChart();
    renderGames(); renderSignals(); renderModel(); renderIntelligence(); renderEvidence(); renderShadow(); renderShadowForward(); renderReplay(); renderMarketChallenge(); renderRiskStress(); renderPricing(); renderExecution(); renderAudit();
  }

  async function loadIntelligence() {
    const [eff,inj]=await Promise.all([
      requestJSON('/api/model/efficiency').catch(err=>({
        available:false,reason:err?.code||'EFFICIENCY_ENDPOINT_UNAVAILABLE'
      })),
      requestJSON('/api/injuries/nfl').catch(err=>({
        available:false,reason:err?.code||'INJURY_ENDPOINT_UNAVAILABLE'
      }))
    ]);
    state.efficiency=eff;
    state.injurySource=inj;
    renderIntelligence();renderAudit();
  }
  async function loadModel() {
    try { state.nflModel = await requestJSON('/api/model/nfl'); }
    catch { state.nflModel = { available:false, reason:'MODEL_ENDPOINT_UNAVAILABLE' }; }
    renderModel(); renderAudit(); renderSpotlight();
  }
  async function loadShadow(){
    const [status,study,demo,forward]=await Promise.all([
      requestJSON('/api/shadow/status').catch(()=>null),
      requestJSON('/api/shadow/study').catch(()=>null),
      requestJSON('/api/shadow/demo').catch(()=>null),
      requestJSON('/api/shadow/derived').catch(()=>null)
    ]);
    state.shadowStatus=status;
    state.shadowStudy=study;
    state.shadowDemo=demo;
    state.shadowDerived=forward;
    state.shadowError=(!status||!study||!demo||!forward)?
      'One or more local shadow research endpoints are unavailable.':null;
    renderShadow();renderShadowForward();
  }
  async function loadRiskStress(){
    try{state.riskStress=await requestJSON('/api/risk/nfl');}
    catch{state.riskStress={available:false,reason:'RISK_RESEARCH_UNAVAILABLE'};}
    renderRiskStress();
  }
  async function loadMarketChallenge(){
    try{
      const research=await requestJSON('/api/research/market');
      state.marketChallenge=research;
    }catch{state.marketChallenge={available:false,reason:'CHALLENGE_ENDPOINT_UNAVAILABLE'};}
    renderMarketChallenge();renderAgentRun();
  }
  async function loadReplay() {
    state.replayLoading = true;
    try {
      const summary = await requestJSON('/api/replay/nfl');
      state.replaySummary = summary;
      state.replayError = summary?.available === true ? null : 'Historical replay report has not been published.';
      state.replayPage = 0;
      if (summary?.available) await loadReplayPlays();
    } catch (err) {
      state.replaySummary = null;
      state.replayError = err?.message || 'Historical replay could not be loaded.';
    } finally {
      state.replayLoading = false;
      renderReplay();
    }
  }
  let replaySerial = 0;
  async function loadReplayPlays() {
    if (!state.replaySummary?.available) return;
    const serial=++replaySerial;
    state.replayLoading=true;
    renderReplay();
    try {
      const p='/api/replay/nfl/plays?season='+state.replaySeason+
        '&ev='+state.replayThreshold+'&page='+state.replayPage;
      const data=await requestJSON(p);
      if(serial!==replaySerial)return;
      state.replayPlays=data;
      state.replayError=null;
    }catch(err){
      if(serial!==replaySerial)return;
      state.replayPlays=null;
      state.replayError=err?.message||'Selected play list unavailable.';
    }finally{
      if(serial===replaySerial){
        state.replayLoading=false;
        renderReplay();
      }
    }
  }
  async function loadEvidence() {
    try { state.evidence = await requestJSON('/api/evidence/nfl'); }
    catch { state.evidence = { error:'EVIDENCE_ENDPOINT_UNAVAILABLE' }; }
    renderEvidence(); renderAudit();
  }
  async function loadHealth() {
    try { state.sourceHealth = await requestJSON('/api/health'); }
    catch { state.sourceHealth = null; }
  }
  let loadSerial = 0;
  async function loadSlate() {
    const serial = ++loadSerial;
    state.loading = true; state.error = null;
    state.slate=null;state.selectedId=null;
    render();
    try {
      const path = '/api/slate?sport=' + encodeURIComponent(state.sport) +
        '&market=' + encodeURIComponent(state.market) + '&mode=' + encodeURIComponent(state.mode);
      const slate = await requestJSON(path);
      if (serial !== loadSerial) return;
      state.slate = slate; state.error = null;
      if (!findSignal(state.selectedId)) state.selectedId = null;
    } catch (err) {
      if (serial !== loadSerial) return;
      state.error = { code: err.code || 'FETCH_FAILED', message: err.message };
      state.slate = null; state.selectedId = null;
    } finally {
      if (serial === loadSerial) {
        state.loading = false;
        render();
      }
    }
  }

  async function loadScores() {
    if (state.mode === 'demo') return toast('Demo mode has no real game scores.');
    $('scores').innerHTML = '<div class="notice info">Retrieving score feed…</div>';
    try {
      const data = await requestJSON('/api/scores?sport=' + encodeURIComponent(state.sport));
      const games = data.games || [];
      $('scores').innerHTML = games.length ? '<section class="panel"><div class="panel-head"><div><span class="panel-kicker">THE ODDS API</span><h3>Scores & game status</h3></div><span class="faint-caption">RECEIVED ' +
        esc(when(data.receivedAt)) + '</span></div><div class="score-rows">' +
        games.slice(0, 24).map(g => {
          const names = new Map((g.scores || []).map(x => [x.name, x.score]));
          return '<div class="score-entry"><span>' + esc(g.awayTeam) + ' <b>' + esc(names.get(g.awayTeam) ?? '—') +
            '</b> @ ' + esc(g.homeTeam) + ' <b>' + esc(names.get(g.homeTeam) ?? '—') +
            '</b></span><span>' + (g.completed ? 'FINAL' : 'SCHEDULED / LIVE') + '</span></div>';
        }).join('') + '</div></section>' :
        empty('No scores returned', 'The source reports no recent/active games for this league.');
    } catch (error) {
      $('scores').innerHTML = '<div class="notice"><span>!</span><p>' + esc(error.message) + '</p></div>';
    }
  }

  document.addEventListener('click', (event) => {
    const replayYear=event.target.closest('[data-replay-season]');
    if(replayYear){
      state.replaySeason=Number(replayYear.dataset.replaySeason);
      $('replay-season').value=String(state.replaySeason);
      state.replayPage=0;state.replayPlays=null;loadReplayPlays();return;
    }
    const shadowView=event.target.closest('[data-shadow-view]');
    if(shadowView&&['live','demo'].includes(shadowView.dataset.shadowView)){
      state.shadowView=shadowView.dataset.shadowView;
      renderShadow();return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    const sport = event.target.closest('[data-sport]');
    if (sport) { state.sport = sport.dataset.sport; persist(); $('scores').innerHTML = ''; loadSlate(); return; }
    const market = event.target.closest('[data-market]');
    if (market) { state.market = market.dataset.market; persist(); loadSlate(); return; }
    const mode = event.target.closest('[data-mode]');
    if (mode) { state.mode = mode.dataset.mode; persist(); $('scores').innerHTML = ''; loadSlate(); return; }
    const pick = event.target.closest('[data-pick]');
    if (pick) { state.selectedId = pick.dataset.pick; renderSpotlight(); renderOpportunities(); if (state.tab !== 'overview') setTab('overview'); return; }
    const watch = event.target.closest('[data-watch]');
    if (watch) { toggleWatch(watch.dataset.watch); return; }
    const paper = event.target.closest('[data-paper]');
    if (paper) { stagePaper(paper.dataset.paper); return; }
    const result = event.target.closest('[data-settle]');
    if (result) { settlePaper(result.dataset.settle, result.dataset.result); return; }
    const action = event.target.closest('[data-action]');
    if (action?.dataset.action === 'replay-prev'){
      if(state.replayPage>0){state.replayPage--;loadReplayPlays();}return;
    }
    if (action?.dataset.action === 'replay-next'){
      if(state.replayPlays&&state.replayPage+1<state.replayPlays.pageCount){
        state.replayPage++;loadReplayPlays();
      }return;
    }
    if (action?.dataset.action === 'refresh') { loadSlate(); loadHealth(); loadEvidence(); return; }
    if (action?.dataset.action === 'scores') { loadScores(); return; }
    if (action?.dataset.action === 'save-settings') { saveSettings(); return; }
  });
  document.addEventListener('keydown', (event) => {
    const row = event.target.closest('tr[data-pick]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); row.click();
    }
  });
  $('pricing-form').addEventListener('submit', (event) => {
    event.preventDefault();
    calculateIllustrativePricing();
  });
  $('menu-toggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('replay-season').addEventListener('change',e=>{
    state.replaySeason=Number(e.target.value);state.replayPage=0;
    state.replayPlays=null;loadReplayPlays();
  });
  $('replay-threshold').addEventListener('change',e=>{
    state.replayThreshold=Number(e.target.value);state.replayPage=0;
    state.replayPlays=null;loadReplayPlays();
  });
  $('signal-search').addEventListener('input', (e) => { state.search = e.target.value; renderSignals(); });
  $('signal-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderSignals(); });
  $('watch-only').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderSignals(); });
  $('clock').textContent = new Date().toLocaleTimeString();
  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString();
    if (state.slate) {renderFeed();renderMetrics();renderOpportunities();renderSpotlight();renderSignals();}
    if (state.slate) $('last-refreshed').textContent = 'Received ' + relativeAge(state.slate.receivedAt) +
      (state.slate.cacheHit ? ' · Cached' : '');
  }, 15000);
  // Paid odds requests are manual-only to protect the limited API credit allowance.
  // Users may click ↻ or change leagues/markets to request a fresh cached snapshot.
  syncSettings();
  render();
  loadHealth();
  loadModel();
  loadIntelligence();
  loadEvidence();
  loadReplay();
  loadMarketChallenge();
  loadRiskStress();
  loadShadow();
  loadPriceVerification();
  loadSlate();
})();
