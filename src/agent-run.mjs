/**
 * Deterministic, auditable BETQ agent evaluation.
 * "Agents" are explicit calculation stages, not hidden LLM consensus.
 * Called each time a fresh /api/slate response is built; no additional
 * paid provider calls, no fictitious prediction confidence or auto-wagers.
 */
const finite=Number.isFinite;
const round=(n,d=2)=>finite(n)?Number(n.toFixed(d)):null;

export function assembleAgentRun(slate,replaySummary,{now=Date.now(),marketChallenge=null}={}){
  if(!slate||!Array.isArray(slate.events))throw Error('Invalid slate for agent analysis');
  const demo=slate.demo===true;
  const nfl=slate.sport==='americanfootball_nfl';
  const moneyline=slate.market==='h2h';
  const games=slate.events;
  const all=games.flatMap(g=>g.opportunities||[]);
  const liveModel=games.filter(g=>!g.started&&g.independentModel?.available);
  const recentQuotes=all.filter(o=>finite(o.quoteAgeSeconds)&&o.quoteAgeSeconds<=600);
  const candidate=games.flatMap(g=>(g.opportunities||[])
    .filter(o=>!g.started&&finite(o.eloIndicativeEvPercent)&&
      o.eloIndicativeEvPercent>=3&&finite(o.eloBaselineProbability))
    .map(o=>({
      gameId:g.id,matchup:g.awayTeam+' at '+g.homeTeam,
      selection:o.selection,bookmaker:o.bookmaker,
      price:o.americanOdds,modelProbability:o.eloBaselineProbability,
      estimatedModelEVPercent:o.eloIndicativeEvPercent,
      priceEdgePoints:o.eloPriceEdgePoints,
      originalMarketStatus:o.status,
      researchOnly:true,authorizedForWager:false
    })))
    .sort((a,b)=>b.estimatedModelEVPercent-a.estimatedModelEVPercent);
  const bench=Array.isArray(replaySummary?.years)?replaySummary.years:[];
  const validHistorical=bench.length>=3&&bench.every(y=>
    finite(y.allGameForecast?.brier)&&finite(y.closingMarketBenchmark?.brier));
  const marketWins=validHistorical&&bench.every(y=>
    y.closingMarketBenchmark.brier<y.closingMarketBenchmark.pairedModelBrier);
  const gatedYears=Array.isArray(marketChallenge?.years)?marketChallenge.years:[];
  const nestedValidation=gatedYears.length>=4&&gatedYears.every(y=>
    y.training?.trainedOnYears?.[1]<y.season&&
    Number.isFinite(y.modelContributionWeight)&&
    Number.isFinite(y.closingMarket?.brier));
  const allIndependentWeightsZero=nestedValidation&&gatedYears.every(y=>y.modelContributionWeight===0);
  const freshMarketGames=games.filter(g=>!g.started&&g.marketConsensus?.available===true).length;
  const favoritesBenchmark=marketChallenge?.pooledPolicy?.MARKET_FAVORITE_65||null;
  const auditYears=Array.isArray(marketChallenge?.years)?marketChallenge.years:[];
  const underdogCount=auditYears.reduce((n,y)=>n+(Number.isInteger(y.falseEdgeAudit?.marketUnderdogCandidates)?
    y.falseEdgeAudit.marketUnderdogCandidates:0),0);
  const priceSelections=auditYears.reduce((n,y)=>n+(Number.isInteger(y.falseEdgeAudit?.original3PercentCandidates)?
    y.falseEdgeAudit.original3PercentCandidates:0),0);
  const underdogShare=priceSelections>0?100*underdogCount/priceSelections:null;
  const selectionBiasReady=auditYears.length>=4&&priceSelections>=500;
  const selectionBiasFlag=selectionBiasReady&&underdogShare>=75;
  const yearDetails=bench.map(y=>({season:y.season,
    modelBrier:y.allGameForecast?.brier??null,
    marketBrier:y.closingMarketBenchmark?.brier??null}));
  const stages=[
    {id:'market',name:'Market Data Agent',state:demo?'DEMO':recentQuotes.length?'OBSERVED':'NO_FRESH_QUOTES',
      detail:demo?'Synthetic demonstrations only':
        recentQuotes.length+' price observations with acceptable recorded age',
      source:demo?'SYNTHETIC_DEMO':'THE_ODDS_API_V4'},
    {id:'quant',name:'Probability Agent',state:liveModel.length?'ELO_RESEARCH':'INSUFFICIENT_MODEL',
      detail:liveModel.length+' eligible pregame Elo projections; challenger not automatically promoted',
      source:'NFL_ELO_HISTORICAL_OUTCOMES'},
    {id:'calibration',name:'Market Calibration Agent',
      state:!nestedValidation?'AWAITING_NESTED_VALIDATION':
        allIndependentWeightsZero?'MODEL_WEIGHT_REJECTED':'RESEARCH_WEIGHT_NOT_PROMOTED',
      detail:nestedValidation?gatedYears.length+
        ' prior-year-fitted model/market comparisons; independent residual contribution '+
        (allIndependentWeightsZero?'failed robust improvement gates':
          'not approved for real-time price execution'):
        'No verified prior-year market-adjusted calibration artifact',
      source:'NESTED_YEARLY_MARKET_CHALLENGE'},
    {id:'selection',name:'Selection Bias Guardian',
      state:!selectionBiasReady?'INSUFFICIENT_REPLAY':
        selectionBiasFlag?'UNDERDOG_CONCENTRATION':'HISTORICAL_SELECTION_REVIEW',
      detail:selectionBiasReady?
        underdogCount+' of '+priceSelections+
        ' original positive-EV candidates were priced as market underdogs ('+
        round(underdogShare,2)+'%). Old Elo selection optimism invalidates automatic promotion.':
        'No complete source-attributed candidate-position distribution',
      source:'HISTORICAL_CLOSING_REFERENCE_NOT_EXECUTABLE'},
    {id:'history',name:'Historical Audit Agent',state:validHistorical?'MARKET_BENCHMARK_READY':'NO_REPLAY',
      detail:validHistorical?bench.length+' historical seasons compared; market better on all '+bench.length+
        ': '+(marketWins?'yes':'no'):'No valid season-by-season closing-price replay',
      source:'NFLVERSE_CLOSING_REFERENCE'},
    {id:'risk',name:'Risk & Execution Agent',state:'NO_REAL_WAGERING',
      detail:'CLV and real-money ROI unverified; any apparent model EV is research only',
      source:'INDEPENDENT_RISK_GATES'}
  ];
  let reason,decision;
  if(demo){decision='DEMO_NO_ACTION';reason='Synthetic teams and odds cannot establish a real wager.';}
  else if(!nfl||!moneyline){decision='PASS_UNMODELED_MARKET';reason='No independent, validated model for this sport or contract.';}
  else if(!liveModel.length){decision='PASS_MISSING_MODEL';reason='No eligible fresh pregame model projections.';}
  else if(!validHistorical){decision='PASS_NO_HISTORY';reason='Historical market benchmark has not been audited.';}
  else if(nestedValidation && allIndependentWeightsZero){
    decision='PASS_NO_PROVEN_MARKET_EDGE';
    reason='Prior-year calibration rejected an independent Elo contribution in all four seasons. Market-only probability may be the better research reference but does not establish a bet.';
  }
  else if(marketWins){decision='PASS_NO_PROVEN_MARKET_EDGE';
    reason='The historical closing-market reference had lower Brier error in every evaluated season; apparent positive model EV is not reliable evidence of value.';}
  else {decision='RESEARCH_ONLY_UNPROMOTED';
    reason='Historical market comparisons are mixed, but pricing, injuries, calibrated forward validation and true fills are not verified.';}
  return {
    schema:1,version:'quant-agent-run-2',evaluatedAt:new Date(now).toISOString(),
    dataMode:demo?'DEMO':'LIVE',sport:slate.sport,market:slate.market,
    decision,reason,stages,
    sourceModel:'SEPARATE_ELO_BASELINE',
    realMoneyROI:null,verifiedCLV:null,mayWager:false,
    modelEligibleGames:liveModel.length,
    observedOffers:all.length,freshQuoteObservations:recentQuotes.length,
    historicalMarketYears:yearDetails,
    marketBenchmarkConsistentlyBetter:Boolean(marketWins),
    modelPriceCandidatesReviewed:candidate.length,
    nestedCalibrationReady:Boolean(nestedValidation),
    allIndependentContributionsRejected:Boolean(allIndependentWeightsZero),
    freshThreeBookMarketGames:freshMarketGames,
    historicalUnderdogSelectionAudit:{
      available:selectionBiasReady,
      candidateSelections:priceSelections||null,
      marketUnderdogSelections:selectionBiasReady?underdogCount:null,
      marketUnderdogSharePercent:selectionBiasReady?round(underdogShare,2):null,
      riskFlag:selectionBiasFlag?'MODEL_OVERSELECTS_MARKET_UNDERDOGS':'NOT_ESTABLISHED',
      source:'UNVERIFIED_HISTORICAL_CLOSING_REFERENCE',
      noVerifiedROI:true
    },
    marketFavorite65Historical:{
      graded:favoritesBenchmark?.graded??null,
      winRatePercent:favoritesBenchmark?.winRatePercent??null,
      hypotheticalClosingPriceROIPercent:favoritesBenchmark?.hypotheticalClosingPriceROIPercent??null,
      verifiedROI:null,
      interpretation:'HIGH_HIT_RATE_DOES_NOT_MEAN_PROFIT'
    },
    marketAnchorUse:'FRESH_MULTI_BOOK_RESEARCH_ONLY_NOT_INDEPENDENT',
    researchCandidates:candidate.slice(0,6),
    presentation:[
      'Market-price discrepancies are not automatically expected profit.',
      'Win/loss of filtered selections is distinct from all-game forecast accuracy.',
      'Historical closing prices are not authenticated earlier fills.',
      'Historical favorites with a high winning percentage still lost stake return under the illustrated closing-price assumption.',
      'A PASS does not become a BET when a model-generated probability is large.'
    ]
  };
}
