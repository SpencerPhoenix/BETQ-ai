// Test-only in-memory ledger for HTTP/source tests. Not durable; never imported by production.
import {createOddsSource} from '../../src/odds.mjs';
export function mockBudget({clock=Date.now,dailyCreditCap=12,reserveCredits=50,remaining=100000}={}) {
  const limit=typeof dailyCreditCap==='number' && Number.isFinite(dailyCreditCap) ?
    Math.max(0,Math.min(100,Math.floor(dailyCreditCap))) : 0;
  const floor=Number.isSafeInteger(reserveCredits)&&reserveCredits>=0 ? reserveCredits : null;
  let day='',used=0,serial=0;
  const error=code=>Object.assign(new Error('Offline budget fixture blocked'),{code,status:429});
  const status=()=>{
    const utcDay=new Date(clock()).toISOString().slice(0,10);
    if(day!==utcDay){day=utcDay;used=0;}
    return {utcDay:day,used,limit,available:Math.max(0,limit-used),minimumProviderCredits:floor,
      providerRemaining:remaining,persistent:false,ready:floor!==null&&used<limit&&remaining>floor};
  };
  return {
    async status(){return status();},
    async reserve({estimatedCredits}){
      status();
      if(used+estimatedCredits>limit)throw error('API_DAILY_BUDGET');
      if(floor===null)throw error('INVALID_BUDGET_CONFIGURATION');
      if(remaining-estimatedCredits<floor)throw error('PROVIDER_CREDIT_RESERVE');
      used+=estimatedCredits;remaining-=estimatedCredits;
      return {id:++serial,estimatedCredits,utcDay:day};
    },
    async reconcile(reservation,quota){
      const extra=Number.isSafeInteger(quota.last) ? Math.max(0,quota.last-reservation.estimatedCredits):0;
      if(day===reservation.utcDay)used+=extra;
      remaining=Math.max(0,remaining-extra);
      if(Number.isSafeInteger(quota.remaining)&&quota.remaining>=0)remaining=Math.min(remaining,quota.remaining);
    }
  };
}
export function createTestOddsSource(options={}) {
  return createOddsSource({...options,budgetStore:options.budgetStore||mockBudget(options)});
}
