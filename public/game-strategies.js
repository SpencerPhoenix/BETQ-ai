/* Read-only strategy explanations. No provider access, orders, sizing or model promotion. */
(() => {
  'use strict';
  const markets = {h2h:'Moneyline', spreads:'Spread / side', totals:'Game total'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const signed = n => (n > 0 ? '+' : '') + n;
  // Match the server's explicit-offset/calendar rule; never infer a browser timezone.
  // The combined integration suite checks parity with scheduledInstant().
  const time = value => {
    if(typeof value !== 'string')return NaN;
    const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if(!parts)return NaN;
    const [,y,m,d,h,minute,second,fraction,zone]=parts,ms=Number((fraction||'').padEnd(3,'0'));
    const offset=zone==='Z'?0:(zone[0]==='+'?1:-1)*(Number(zone.slice(1,3))*60+Number(zone.slice(4)));
    if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4))>59))return NaN;
    const at=Date.parse(value),local=new Date(at+offset*60000);
    return Number.isFinite(at)&&local.getUTCFullYear()===Number(y)&&local.getUTCMonth()+1===Number(m)&&
      local.getUTCDate()===Number(d)&&local.getUTCHours()===Number(h)&&local.getUTCMinutes()===Number(minute)&&
      local.getUTCSeconds()===Number(second)&&local.getUTCMilliseconds()===ms?at:NaN;
  };
  const timestamp = value => Number.isFinite(time(value)) ? new Date(time(value)).toISOString() : 'Unavailable';
  const percent = n => (n * 100).toFixed(2) + '%';
  const contexts = new Map();
  const decimal = price => Number.isFinite(price) && Math.abs(price) >= 100 && Math.abs(price) <= 1000000
    ? (price > 0 ? 1 + price / 100 : 1 + 100 / -price) : null;
  const validPoint = point => Number.isFinite(point) && Math.abs(point) <= 1000 && Number.isInteger(point * 2);

  function outcomes(market, side, point, team) {
    if (market === 'h2h') return {
      win: team + ' wins the quoted game period.',
      loss: 'The opposing team wins the quoted game period.',
      push: 'A tie is not assumed to push. Two-way tie/void treatment and overtime inclusion require the book’s exact rules.'
    };
    if (market === 'spreads') return {
      win: team + ' score minus opponent score, plus ' + signed(point) + ', is greater than 0.',
      loss: 'That adjusted margin is less than 0. An outright win can still lose a negative spread.',
      push: Number.isInteger(point) ? 'That adjusted margin equals 0: stake returned under standard full-game spread rules.'
        : 'No exact push on this half-point line with integer scores.'
    };
    return {
      win: 'Combined score is ' + (side === 'over' ? 'greater' : 'less') + ' than ' + point + '.',
      loss: 'Combined score is ' + (side === 'over' ? 'less' : 'greater') + ' than ' + point + '.',
      push: Number.isInteger(point) ? 'Combined score equals ' + point + ': stake returned under standard full-game total rules.'
        : 'No exact push on this half-point line with integer scores.'
    };
  }
  function scenario(market, side, point, team) {
    if (market === 'h2h') return 'If your thesis is that ' + team + ' wins outright, compare its moneyline price. A likely winner can still be overpriced.';
    if (market === 'spreads') return point < 0
      ? 'If your thesis is that ' + team + ' wins by more than ' + -point + ', examine this negative spread. Winning narrowly is not enough.'
      : point > 0 ? 'If your thesis is a close game or an outright ' + team + ' win, examine this +' + point + ' spread. Losing by more than ' + point + ' loses.'
      : 'If your thesis is that ' + team + ' wins, a 0-point spread removes the handicap; a tied score pushes under standard rules.';
    return 'If independently verified evidence supports a ' + (side === 'over' ? 'higher' : 'lower') + '-scoring game, compare ' + side + ' ' + point + '. A winner prediction does not establish a total.';
  }
  function quoteStatus(quote, event, options) {
    if (options.retained) return 'Archived research only; no current quote is available.';
    if (options.synthetic) return 'SYNTHETIC DEMO: invented event and price, never a live offer.';
    if (options.source !== 'THE_ODDS_API_V4' || options.mode !== 'live' || event.demo !== false)
      return 'Source identity unverified; do not treat this as a live offer.';
    if(event.scheduleReview?.status==='SCHEDULE_RECONCILIATION_REQUIRED')
      return 'Known schedule conflict: reconciliation required; PASS. This quote does not verify the current kickoff or game status.';
    if(event.scheduleReview?.status==='SCHEDULE_REVIEW_IDENTITY_MISMATCH')
      return 'Schedule identity mismatch: review required; PASS. No corrected kickoff or current game status is verified.';
    const now = options.now, at = time(quote.lastUpdated), received = time(options.receivedAt), kickoff = time(event.commenceTime);
    if (!Number.isFinite(now) || !Number.isFinite(at) || !Number.isFinite(received) || !Number.isFinite(kickoff))
      return 'Source or kickoff timestamp missing; freshness unverified.';
    if (at > now || received > now || at > received + 60000) return 'Source chronology invalid or future-dated; PASS.';
    if (now - at > 600000 || now - received > 600000) return 'STALE retained quote: older than 10 minutes; PASS.';
    if (kickoff - now <= 300000 || event.started === true) return 'Scheduled start passed, within 5 minutes, or flagged as started in the cached snapshot; actual game status unverified. PASS. This is not an in-play strategy.';
    return 'Cached provider quote within 10 minutes at this check; availability and book rules remain unverified.';
  }
  function validQuote(q, event, market) {
    if (!q || typeof event.id !== 'string' || !event.id || event.homeTeam === event.awayTeam ||
        q.eventId !== event.id || q.market !== market || (q.period != null && q.period !== 'full_game') || decimal(q.americanOdds) === null ||
        typeof q.bookmaker !== 'string' || !q.bookmaker.trim() || !['home','away'].every(k => typeof event[k+'Team'] === 'string' && event[k+'Team'])) return false;
    if (market === 'h2h') return ['home','away'].includes(q.side) && q.contractId === 'h2h' && q.point == null;
    if (!validPoint(q.point)) return false;
    if (market === 'spreads') return ['home','away'].includes(q.side) && q.contractId === 'spread:' + (q.side === 'home' ? q.point : -q.point);
    return ['over','under'].includes(q.side) && q.point >= 0 && q.contractId === 'total:' + q.point;
  }
  const probabilityPair = (home, away) => Number.isFinite(home) && Number.isFinite(away) &&
    home > 0 && home < 1 && away > 0 && away < 1 && Math.abs(home + away - 1) < 0.00001;
  function evaluation(event, options) {
    const now=options.now, received=time(options.receivedAt), kickoff=time(event.commenceTime);
    const current=!options.retained && !options.synthetic && options.market==='h2h' &&
      options.source==='THE_ODDS_API_V4' && options.mode==='live' && event.demo===false &&
      !['SCHEDULE_RECONCILIATION_REQUIRED','SCHEDULE_REVIEW_IDENTITY_MISMATCH'].includes(event.scheduleReview?.status) &&
      Number.isFinite(now) && Number.isFinite(received) && received<=now && now-received<=600000 &&
      Number.isFinite(kickoff) && kickoff-now>300000 && event.started!==true;
    const market=event.marketConsensus, model=event.independentModel;
    const oldest=time(market?.oldestQuoteAt), newest=time(market?.latestQuoteAt), snapshot=time(market?.snapshotAt);
    const marketValid=current && market?.available===true && market.source==='THE_ODDS_API_V4' &&
      market.market==='h2h' && market.method==='ALL_BOOKS_MEDIAN_DE_VIG' && market.basis==='MARKET_DERIVED_NOT_INDEPENDENT' &&
      Number.isInteger(market.books) && market.books>=3 && probabilityPair(market.homeProbability,market.awayProbability) &&
      Number.isFinite(oldest) && Number.isFinite(newest) && oldest<=newest && newest<=received && now-oldest<=600000 &&
      Number.isFinite(snapshot) && snapshot>=newest && snapshot<=now;
    const built=time(model?.modelBuiltAt);
    const modelValid=current && model?.available===true && model.method==='NFL_ELO_HISTORICAL_OUTCOMES' &&
      model.source==='NFLVERSE_SCHEDULES' && model.independentOfOdds===true && model.use==='RESEARCH_ONLY' &&
      typeof model.modelVersion==='string' && model.modelVersion.length>0 && Number.isFinite(built) && built<=now &&
      probabilityPair(model.homeWinProbability,model.awayWinProbability);
    const injury=event.injuryContext, injuryAt=time(injury?.sourceUpdatedAt), validUntil=time(injury?.validUntil);
    const injuryValid=current && injury?.available===true && injury.source==='NFLVERSE_INJURIES' &&
      Number.isFinite(injuryAt) && injuryAt<=now && Number.isFinite(validUntil) && validUntil>now;
    return {
      market:marketValid?{home:market.homeProbability,away:market.awayProbability,books:market.books,oldestQuoteAt:market.oldestQuoteAt}:null,
      model:modelValid?{home:model.homeWinProbability,away:model.awayWinProbability,version:model.modelVersion,builtAt:model.modelBuiltAt}:null,
      limitation:!current?'Current evaluation unavailable: requires a fresh, unambiguous, pregame live moneyline snapshot.':
        !marketValid?'No qualifying current three-book consensus. No current probability is inferred.':
        'Market-implied estimate only, not a validated independent win probability or an injury-adjusted forecast.',
      injury:injuryValid?{sourceUpdatedAt:injury.sourceUpdatedAt,teams:['home','away'].map(side=>({
        team:event[side+'Team'],reported:injury[side]?.reported===true,
        count:Number.isInteger(injury[side]?.count)&&injury[side].count>=0?injury[side].count:null
      }))}:null,
      injuryReason:injuryValid?'Public report coverage only; no confirmed starters or probability adjustment.':
        'Injury evidence unavailable, expired or incompatible. Missing reports do not mean healthy players; starters and injury effects remain unverified.'
    };
  }
  function build(event = {}, options = {}) {
    event = event && typeof event === 'object' ? event : {};
    options = options && typeof options === 'object' ? options : {};
    const settings = {...options, now: options.now ?? Date.now()};
    settings.synthetic = options.mode === 'demo' || options.source === 'SYNTHETIC_DEMO' || event.demo === true;
    const assessment = evaluation(event,settings);
    const raw = Array.isArray(event.opportunities) ? event.opportunities : [];
    const groups = Object.entries(markets).map(([market, name]) => {
      const relevant = options.retained || options.market !== market ? [] : raw.filter(q => q?.market === market);
      const candidates = relevant.filter(q => validQuote(q, event, market));
      // A conflicting duplicate is not a reliable quoted contract. Do not pick the favorable one.
      const unique = candidates.filter(q => relevant.filter(other => other.contractId === q.contractId && other.side === q.side).length === 1);
      const cards = unique.slice(0,20).map(q => {
        const team = q.side === 'home' ? event.homeTeam : event.awayTeam;
        const title = market === 'totals' ? (q.side === 'over' ? 'Over ' : 'Under ') + q.point
          : team + (market === 'spreads' ? ' ' + signed(q.point) : ' to win');
        const d = decimal(q.americanOdds);
        const key = market + '|' + q.contractId + '|' + q.side;
        const quoteAt=time(q.lastUpdated), receipt=time(options.receivedAt);
        const comparable=market==='h2h' && assessment.model && Number.isFinite(quoteAt) &&
          quoteAt<=receipt && quoteAt<=settings.now && settings.now-quoteAt<=600000;
        return {
          key, title, market, side:q.side, point:q.point, bookmaker:q.bookmaker,
          price:q.americanOdds, decimalOdds:d, profitPer100:(d-1)*100, breakEven:1/d,
          researchProbability:comparable ? assessment.model[q.side] : null,
          researchPriceGapPoints:comparable ? (assessment.model[q.side]-1/d)*100 : null,
          quoteAt:q.lastUpdated, receivedAt:options.receivedAt, status:'PASS',
          sourceStatus:quoteStatus(q,event,settings), scenario:scenario(market,q.side,q.point,team),
          outcomes:outcomes(market,q.side,q.point,team),
          risk:market === 'h2h' ? 'No validated price edge. Favorite win rate alone does not justify a price.'
            : market === 'spreads' ? 'No validated margin distribution. A moneyline model cannot establish cover probability.'
            : 'No validated total-score distribution. Team-win probabilities cannot establish over/under probability.',
          breakEvenBasis:'Price arithmetic only, conditional on non-push/non-void outcomes. This is not a model confidence or win forecast.'
        };
      });
      const guide = market === 'h2h'
        ? 'Choose a team to win outright. Margin does not matter; tied-game and overtime rules must be checked.'
        : market === 'spreads'
          ? 'A negative handicap needs a large enough win. A positive handicap can cover an outright win or a sufficiently narrow loss. An exact integer-line tie pushes under standard rules.'
          : 'Over needs combined scoring above the line; under needs scoring below it. Equality at an integer line pushes under standard rules.';
      return {market,name,cards,guide,rejected:relevant.length-unique.length,
        unavailable:options.retained ? 'No sportsbook prices or spread/total lines are retained in this dossier.'
          : options.market !== market ? 'Not present in the selected market snapshot. Select ' + name + ' and read its cache separately; this panel does not fetch it.'
          : 'No compatible quoted contract available. No odds, point line or probability has been invented.'};
    });
    return {status:'PASS',wagerRecommendation:false,recommendedUnits:0,
      evaluation:assessment,homeTeam:event.homeTeam,awayTeam:event.awayTeam,
      synthetic:settings.synthetic,retained:options.retained === true,groups,
      sourceLabel:options.retained ? 'ARCHIVED DERIVED RESEARCH · NOT LIVE ODDS'
        : settings.synthetic ? 'SYNTHETIC DEMO · FICTIONAL GAMES AND PRICES'
          : options.source === 'THE_ODDS_API_V4' && options.mode === 'live' && event.demo === false
            ? 'PROVIDER CACHE · NOT A STREAMING LIVE FEED' : 'UNVERIFIED SOURCE · NOT LIVE ODDS',
      checkedAt:Number.isFinite(settings.now) ? new Date(settings.now).toISOString() : 'Unavailable',
      modelNote:'Market prices and no-vig consensus are market-derived. Independent Elo and challenger forecasts, when shown elsewhere, are unpromoted research, not validated betting confidence. No margin, total, injury, starter or weather edge is inferred.'};
  }
  const field = (label, value) => '<dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd>';
  function evaluationBody(report) {
    const e=report.evaluation;
    return '<section class="strategy-evaluation"><h4>Game evaluation at this check</h4><p>'+escape(e.limitation)+'</p><dl>'+
      field('Market-implied probability',e.market ? report.homeTeam+' '+percent(e.market.home)+' · '+report.awayTeam+' '+percent(e.market.away)+
        ' · '+e.market.books+' books · oldest quote UTC '+timestamp(e.market.oldestQuoteAt) : 'Unavailable')+
      field('Independent Elo research baseline',e.model ? report.homeTeam+' '+percent(e.model.home)+' · '+report.awayTeam+' '+percent(e.model.away)+
        ' · '+e.model.version+' · built UTC '+timestamp(e.model.builtAt)+' · not injury adjusted; not a validated price edge' : 'Unavailable or not eligible for current display')+
      field('Injury coverage',e.injury ? e.injury.teams.map(t=>t.team+': '+(t.reported?(t.count===null?'flagged count unavailable':t.count+' flagged players'):'no team report')).join(' · ')+
        ' · source file updated UTC '+timestamp(e.injury.sourceUpdatedAt)+'. '+e.injuryReason : e.injuryReason)+
      field('Decision','PASS. No verified independent edge. Refresh stale evidence and verify starters before interpreting these research comparisons.')+'</dl></section>';
  }
  function body(report) {
    return '<div class="strategy-source">'+escape(report.sourceLabel)+'</div>'+
      '<p class="strategy-pass"><b>PASS · no verified betting edge.</b> Compare conditional ideas, not recommended bets. Suggested stake: 0. No order or paper-staging action is available.</p>'+
      '<p>These are alternatives for the same game, not a portfolio or parlay. They can be correlated, mutually exclusive, or lose together. No probabilities are multiplied and no hedging profit is assumed.</p>'+
      evaluationBody(report)+
      report.groups.map(group=>'<section class="strategy-market"><h4>'+escape(group.name)+'</h4><p>'+escape(group.guide)+'</p>'+
        (!group.cards.length ? '<p class="strategy-unavailable"><b>PASS · unavailable.</b> '+escape(group.unavailable)+'</p>' : group.cards.map(card=>
          '<article class="strategy-option"><h5>'+escape(card.title)+' <span>PASS</span></h5><p>'+escape(card.scenario)+'</p><dl>'+
          field('Quoted price',signed(card.price)+' American · '+card.decimalOdds.toFixed(4)+' decimal · '+card.bookmaker)+
          field('Source and timing',card.sourceStatus+' Quote UTC: '+timestamp(card.quoteAt)+'. Cache received UTC: '+timestamp(card.receivedAt)+'.')+
          field('Win',card.outcomes.win)+field('Lose',card.outcomes.loss)+field('Push / tie',card.outcomes.push)+
          field('Price mechanics, not a stake recommendation','Per 100 hypothetical units risked: win nets '+card.profitPer100.toFixed(2)+', loss nets −100, valid push/void nets 0. Winning return also includes the original stake. Fees and taxes excluded.')+
          field('Required win rate to break even',percent(card.breakEven)+'. '+card.breakEvenBasis)+
          field('Independent research probability / price gap',card.researchProbability===null ? 'Unavailable. No validated probability or edge is invented.' : percent(card.researchProbability)+' · '+signed(card.researchPriceGapPoints.toFixed(2))+' percentage points versus break-even. Unvalidated model arithmetic, not a verified edge; probability is not injury adjusted.')+
          field('Risk / missing evidence',card.risk)+'</dl></article>').join(''))+
        (group.rejected ? '<p class="strategy-unavailable">'+escape(group.rejected)+' incompatible or conflicting quote record(s) excluded. PASS; check contract identity and source.</p>' : '')+'</section>').join('')+
      '<section class="strategy-checklist"><h4>Before considering any scenario</h4><ol><li>Verify the event, teams, period, exact line, price and timestamp. Different lines are different contracts.</li><li>Check the book’s overtime, tie, cancellation and shortened-game rules. The rules above describe standard full-game contracts, not confirmed settlement terms.</li><li>Confirm relevant starters, injuries and conditions from reliable current sources. Missing evidence is not neutral evidence.</li><li>Require a validated probability advantage at that exact price. BETQ has not established one: PASS. Do not chase losses or treat any outcome as guaranteed.</li></ol></section>'+
      '<p class="strategy-model-note">'+escape(report.modelNote)+'</p><p class="strategy-check-time">Freshness checked UTC: '+escape(report.checkedAt)+'. Viewing this panel performs no data collection.</p>';
  }
  function render(event, options = {}) {
    const key = JSON.stringify([options.retained === true,options.mode,options.market,options.source,event?.id]);
    contexts.delete(key); contexts.set(key,{event,options:{...options}});
    return '<details class="game-strategies" data-strategy-key="'+escape(key)+'"><summary>Compare game strategies <span>Moneyline · side · total</span></summary><div class="strategy-body">'+body(build(event,options))+'</div></details>';
  }
  // Update only noninteractive content, preserving native disclosure state and summary focus.
  function refresh(root, now = Date.now()) {
    const mounted = new Set();
    for (const element of root?.querySelectorAll?.('.game-strategies') || []) {
      mounted.add(element.dataset.strategyKey);
      const context = contexts.get(element.dataset.strategyKey);
      const content = element.querySelector('.strategy-body');
      if(context && content)content.innerHTML=body(build(context.event,{...context.options,now}));
      else if(content)content.innerHTML='<p class="strategy-pass">PASS · freshness unverified. This panel’s quote context is unavailable. Reopen from the current game view; no new data is fetched here.</p>';
    }
    // Keep every mounted panel aging, including large slates; release only unmounted contexts.
    for(const key of contexts.keys())if(!mounted.has(key))contexts.delete(key);
  }
  globalThis.BETQGameStrategies = Object.freeze({build,render,refresh});
})();
