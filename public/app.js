/* BETQ.ai terminal: no browser API keys, no real sportsbook execution. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STORE = 'betq-terminal-v1';
  const LEDGER = 'betq-paper-v1';
  const allowedTabs = ['overview', 'games', 'signals', 'model', 'evidence', 'execution', 'audit', 'settings'];
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
    (event.opportunities || []).map((signal) => ({ ...signal, event })));
  const findSignal = (id) => all().find(s => s.id === id);
  const eventLabel = (event) => event.awayTeam + ' @ ' + event.homeTeam;
  const statusTag = (status) => '<span class="status-tag ' +
    (status === 'WATCH' ? 'watch' : 'pass') + '">' + esc(status) + '</span>';
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
      model: 'PREDICTION LAB', evidence: 'FORWARD EVIDENCE', execution: 'PAPER EXECUTION', audit: 'AUDIT & QUALITY', settings: 'SETTINGS'
    })[tab];
    $('sidebar').classList.remove('open');
    if (tab === 'settings') syncSettings();
    if (tab === 'execution') renderExecution();
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
      element.innerHTML = '<span>◇</span><p><b>LIVE MARKET · MANUAL REFRESH.</b> ↻ refreshes on demand to conserve API credits. NFL Elo and the historical EPA challenger appear separately in <button type="button" class="text-link" data-tab="model">Prediction Lab ↗</button>. Injury status may be stale; confirmed starters are not modeled.</p>';
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

  function renderMetrics() {
    const s = state.slate?.summary;
    const signals = all();
    const watch = signals.filter(x => x.status === 'WATCH');
    const best = watch.length ? Math.max(...watch.map(x => x.evPercent || 0)) : null;
    const quality = signals.length ? Math.round(signals.reduce((sum, x) => sum + x.qualityScore, 0) / signals.length) : null;
    const quota = state.slate?.quota?.remaining;
    $('metric-grid').innerHTML =
      metric('GAMES TRACKED', s ? String(s.games) : '—', sportLabels[state.sport] + ' / ' + marketLabels[state.market], '', '◉') +
      metric('WATCH SIGNALS', s ? String(s.watch) : '—', 'Market-derived only', 'lime', '⌁') +
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
      (signal.status === 'WATCH' ? '' : ' disabled') + '>Stage paper ticket ↗</button></div></div>';
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
          esc(signed(top.evPercent)) + '% EV ↗</button>' : '<span>No qualifying quotes</span>') + '</div></article>';
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
      (s.status === 'WATCH' ? '' : ' disabled') + '>+ Paper</button></span></div></article>'
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
    const signal = findSignal(id);
    if (!signal || signal.status !== 'WATCH') return toast('Paper staging blocked: signal is not WATCH.');
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
    if (!ticket || ticket.status !== 'OPEN' || !['WIN', 'LOSS', 'VOID'].includes(result)) return;
    ticket.status = result;
    ticket.settledAt = new Date().toISOString();
    ticket.pnl = result === 'WIN' ? Number((ticket.stake * (ticket.decimalOdds - 1)).toFixed(2))
      : result === 'LOSS' ? -ticket.stake : 0;
    ticket.manualSettlement = true;
    saveLedger(); renderExecution();
    toast('Paper result marked ' + result + '. This result was not verified by a feed.');
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
        '. This is not a forward betting ROI or proof of execution edge.</p>'+
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
        (good?'watch':'pass')+'">'+(good?'HOLDOUT GATE PASSED':'UNPROMOTED')+
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
    const sample = Math.max(0, Number(e.settledGames) || 0);
    const progress = Math.min(30, sample);
    const qualified = Boolean(e.forwardMetrics);
    const positive = e.marketComparison?.consensusMinusModelBrier > 0;
    const stats = '<div class="metric-grid">' +
      metric('PREGAME FORECASTS', String(e.prospectiveGames || 0), 'Unique frozen before kickoff', 'cyan', '◫') +
      metric('FINALS MATCHED', String(sample), 'Later reconciled results · ties excluded', 'lime', '✓') +
      metric('SAME-TIME MARKET PAIRS', String(e.pairedMarketGames || 0), 'Independent median no-vig comparisons', 'violet', '⌁') +
      metric('FORWARD BRIER SCORE', qualified ? num(e.forwardMetrics.brier, 5) : '—',
        qualified ? 'Newly observed games only' : 'Requires 30 completed games', '', '◇') +
      '</div>';
    const gate = '<section class="panel evidence-collection"><div class="panel-head"><div>' +
      '<span class="panel-kicker">PROSPECTIVE EVIDENCE GATE</span><h3>' +
      (qualified ? 'Forward results accumulating' : 'Collecting real outcomes') +
      '</h3></div><span class="status-tag ' + (qualified ? 'watch' : 'pass') + '">' +
      (qualified ? 'SAMPLE AVAILABLE' : 'NOT ENOUGH GAMES') + '</span></div>' +
      '<div class="evidence-body"><p>Every forecast is timestamped before kickoff, retained without rewriting, then matched to a subsequent nflverse final score. ' +
      'BETQ.ai does not backfill historical model probabilities and pass them off as past live forecasts.</p>' +
      '<div class="evidence-progress-head"><b>' + sample + ' of 30 completed games</b>' +
      '<span>' + e.pendingGames + ' still pending</span></div>' +
      '<progress class="evidence-meter" max="30" value="' + progress + '"></progress>' +
      (qualified ? '<div class="evidence-performance"><div><span>Forward winner accuracy</span><strong>' +
        pct(e.forwardMetrics.winnerAccuracy, 2) + '</strong></div><div><span>Forward log loss</span><strong>' +
        num(e.forwardMetrics.logLoss, 5) + '</strong></div></div>' :
        '<p class="evidence-warning">Winner accuracy, model advantage and any performance claims stay withheld until at least 30 independently settled games are available. ' +
        'Thirty games is an initial reporting threshold, not sufficient to prove statistical or financial superiority.</p>') +
      '</div></section>';
    const mc = e.marketComparison;
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
          'At least 30 finalized NFL games must contain both frozen model probabilities and the same-time, de-vigged multi-book market reference.')) +
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
      ' · ' + esc(x.result) + '</small></div><div class="evidence-numbers"><b>' +
      pct(x.modelHomeProbability) + '</b><small>Brier: ' + num(x.brier, 4) +
      '</small></div></div>').join('');
    const ledger = '<section class="panel"><div class="panel-head"><div>' +
      '<span class="panel-kicker">IMMUTABLE FORECAST JOURNAL</span><h3>Pending game evidence</h3></div>' +
      '<span class="faint-caption">HOME TEAM MODEL P</span></div>' +
      (dates ? '<div class="evidence-list">' + dates + '</div>' :
        empty('No pending tracked games', 'The scheduled collector has not captured eligible future NFL games yet.')) +
      '</section><section class="panel"><div class="panel-head"><div>' +
      '<span class="panel-kicker">SOURCE-ALIGNED RESULTS</span><h3>Finalized forecast results</h3></div>' +
      '<span class="faint-caption">HOME TEAM MODEL P</span></div>' +
      (recent ? '<div class="evidence-list">' + recent + '</div>' :
        empty('No completed forward forecasts yet', 'Results appear here after previously captured games are finalized in nflverse schedules.')) +
      '</section>';
    const cf=e.challengerForwardComparison;
    const challengerBlock='<section class="panel evidence-challenger"><div class="panel-head">'+
      '<div><span class="panel-kicker">EPA CHALLENGER / FROZEN PREGAME</span>'+
      '<h3>Prospective Elo vs EPA comparison</h3></div>'+
      '<span class="status-tag '+(cf?'watch':'pass')+'">'+
      (cf?'30+ FINALS':'COLLECTING')+'</span></div>'+
      '<div class="evidence-body"><p><b>'+
      esc(String(e.prospectiveChallengerGames||0))+
      ' future games with an independent EPA challenger frozen before kickoff.</b> '+
      esc(String(e.pairedChallengerSettled||0))+
      ' matching games have subsequently reached a finalized, non-tied outcome. '+
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
        esc(String(e.pairedChallengerSettled||0))+
        ' / 30 finished paired games</b><span>No retrospective backfill</span></div>'+
        '<progress class="evidence-meter" max="30" value="'+
        Math.min(30,Math.max(0,Number(e.pairedChallengerSettled)||0))+
        '"></progress><p>Scores remain hidden until a minimum 30 challenger '+
        'forecasts were frozen and their games subsequently completed.</p>')+
      '</div></section>';
    root.innerHTML = stats + '<div class="evidence-columns">' + gate + benchmark + '</div>' +
      challengerBlock +
      '<div class="evidence-columns evidence-lists">' + ledger + '</div>' +
      '<div class="notice info evidence-footer"><span>◇</span><p><b>Auditable, not promotional.</b> ' +
      'No verified closing-line value, no real-money ROI, no betting orders, and no presumed model advantage. ' +
      'The historical 2025 backtest is not included in this prospective cohort. ' +
      'Scores come from community-maintained nflverse schedules. Last evidence publication: ' +
      esc(when(e.generatedAt)) + '.</p></div>';
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
          String(state.evidence.settledGames) + ' scored against later results' :
          'Evidence journal not yet available',
        state.evidence?.settledGames >= 30 ? 'SAMPLE READY' : 'COLLECTING',
        state.evidence?.settledGames >= 30),
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
    renderFilters(); renderFeed(); renderBanner(); renderMetrics();
    renderOpportunities(); renderSpotlight(); renderChart();
    renderGames(); renderSignals(); renderModel(); renderIntelligence(); renderEvidence(); renderExecution(); renderAudit();
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
    renderBanner();
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
  $('menu-toggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('signal-search').addEventListener('input', (e) => { state.search = e.target.value; renderSignals(); });
  $('signal-sort').addEventListener('change', (e) => { state.sort = e.target.value; renderSignals(); });
  $('watch-only').addEventListener('change', (e) => { state.watchOnly = e.target.checked; renderSignals(); });
  $('clock').textContent = new Date().toLocaleTimeString();
  setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString();
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
  loadSlate();
})();
