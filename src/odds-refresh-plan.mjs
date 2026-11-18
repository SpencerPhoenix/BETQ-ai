/** Pure operator planning, NOT an executor, scheduler, reservation, or permission
 * to spend. Caller must separately acquire durable account-scoped budget. */
export function planOddsRefresh({enabled=false,now,gameTimes=[],lastCycleAt=null,
  intervalMs,windowBeforeMs,remaining,dailyRemaining,reserve,maximumCycles,cyclesUsed}={}) {
  const no=reason=>({eligible:false,reason,estimatedCredits:0,requests:[]});
  if(enabled!==true)return no('DISABLED');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(intervalMs)||intervalMs<300000||
    !Number.isSafeInteger(windowBeforeMs)||windowBeforeMs<intervalMs||windowBeforeMs>86400000||
    ![remaining,dailyRemaining,reserve,maximumCycles,cyclesUsed].every(v=>Number.isSafeInteger(v)&&v>=0)||
    !Array.isArray(gameTimes)||gameTimes.length>1000||gameTimes.some(t=>!Number.isSafeInteger(t))||
    (lastCycleAt!==null&&(!Number.isSafeInteger(lastCycleAt)||lastCycleAt>now)))return no('INVALID_PLAN_INPUT');
  if(cyclesUsed>=maximumCycles)return no('CYCLE_CAP');
  if(lastCycleAt!==null&&now-lastCycleAt<intervalMs)return no('INTERVAL');
  if(!gameTimes.some(t=>t>now&&t-now<=windowBeforeMs))return no('NO_PREGAME_WINDOW');
  if(dailyRemaining<3||remaining<reserve||remaining-reserve<3)return no('CREDIT_LIMIT');
  return {eligible:true,reason:'REQUIRES_OPERATOR_AND_DURABLE_RESERVATION',estimatedCredits:3,
    requests:['h2h','spreads','totals'].map(market=>({sport:'americanfootball_nfl',market}))};
}
