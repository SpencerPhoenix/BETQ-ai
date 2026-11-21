/** Additional opt-in trial ceiling. No providers, credentials, schema or quota seeding. */
import {isProviderBudgetAccountId} from './provider-budget.mjs';
import {guardPostgresClient} from './postgres-security.mjs';
const markets=new Set(['h2h','spreads','totals']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class OwnerTrialError extends Error {
  constructor(code){super('Owner refresh trial is not available for this operation.');this.name='OwnerTrialError';this.code=code;}
}
const fail=code=>{throw new OwnerTrialError(code);};
const integer=value=>{const n=typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)?Number(value):value;
  if(!Number.isSafeInteger(n)||n<0)fail('OWNER_TRIAL_STORAGE_INVALID');return n;};
export function createOwnerTrialStore({pool,accountId,enabled=false}={}) {
  function configured(){if(enabled!==true)fail('OWNER_TRIAL_DISABLED');
    if(!isProviderBudgetAccountId(accountId)||typeof pool?.connect!=='function')fail('OWNER_TRIAL_CONFIG_INVALID');}
  function identity({operationId,market}={}){if(typeof operationId!=='string'||!uuid.test(operationId)||!markets.has(market))fail('OWNER_TRIAL_INPUT_INVALID');return {operationId:operationId.toLowerCase(),market};}
  async function transaction(work){
    configured();let guard;
    try{
      const client=await pool.connect();guard=guardPostgresClient(client);
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='5s'");
      // Transaction-scoped lock works with transaction pooling; hash collisions only
      // over-serialize unrelated accounts. No session-level locks or policy UPDATE grants.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('betq-owner-trial:' || $1,0))",[accountId]);
      const result=await work(client);await client.query('COMMIT');guard.assertHealthy();return result;
    }catch(error){if(guard)await guard.rollback();if(error instanceof OwnerTrialError&&!guard?.failed)throw error;
      guard?.markFailed();fail('OWNER_TRIAL_STORAGE_UNAVAILABLE');
    }finally{if(guard)try{guard.release();}catch{fail('OWNER_TRIAL_STORAGE_UNAVAILABLE');}}
  }
  async function policy(client){
    const {rows}=await client.query(`SELECT trial_id,enabled,lifetime_credit_limit,daily_credit_limit,
      expires_at::text AS expires_at,
      (isfinite(starts_at) AND isfinite(expires_at) AND expires_at>starts_at
       AND expires_at<=starts_at+interval '168 hours') AS window_valid,
      (starts_at<=checked_at AND checked_at<expires_at) AS current,
      to_char(checked_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS utc_day
      FROM owner_refresh_trial_policies CROSS JOIN (SELECT clock_timestamp() AS checked_at) AS trial_clock WHERE account_id=$1`,[accountId]);
    if(rows.length!==1)fail('OWNER_TRIAL_POLICY_REQUIRED');const p=rows[0];
    const lifetime=integer(p.lifetime_credit_limit),daily=integer(p.daily_credit_limit);
    if(!uuid.test(p.trial_id??'')||typeof p.enabled!=='boolean'||p.window_valid!==true||typeof p.current!=='boolean'||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.utc_day??'')||!Number.isFinite(Date.parse(p.expires_at))||lifetime<1||lifetime>36||daily<1||daily>12||daily>lifetime)fail('OWNER_TRIAL_STORAGE_INVALID');
    return {...p,lifetime,daily};
  }
  async function state(client,p){
    const {rows}=await client.query(`SELECT COALESCE(SUM(charged_credits),0)::text AS lifetime_used,
      COALESCE(SUM(charged_credits) FILTER (WHERE utc_day=$2::date),0)::text AS daily_used,
      COUNT(*) FILTER (WHERE state<>'completed')::text AS unresolved
      FROM owner_refresh_trial_operations WHERE account_id=$1`,[accountId,p.utc_day]);
    if(rows.length!==1)fail('OWNER_TRIAL_STORAGE_INVALID');const r=rows[0];
    const lifetimeUsed=integer(r.lifetime_used),dailyUsed=integer(r.daily_used),unresolved=integer(r.unresolved);
    const reason=!p.enabled?'OWNER_TRIAL_DISABLED':!p.current?'OWNER_TRIAL_EXPIRED':unresolved?'OWNER_TRIAL_UNRESOLVED':
      lifetimeUsed>=p.lifetime||dailyUsed>=p.daily?'OWNER_TRIAL_LIMIT':null;
    return {accountId,trialId:p.trial_id,expiresAt:p.expires_at,lifetimeUsed,dailyUsed,lifetimeLimit:p.lifetime,dailyLimit:p.daily,unresolved,ready:reason===null,reason};
  }
  async function operation(client,id){const {rows}=await client.query('SELECT trial_id,market,charged_credits,state FROM owner_refresh_trial_operations WHERE account_id=$1 AND operation_id=$2::uuid',[accountId,id.operationId]);
    if(rows.length>1)fail('OWNER_TRIAL_STORAGE_INVALID');
    if(rows[0]&&rows[0].market!==id.market)fail('OWNER_TRIAL_OPERATION_MISMATCH');return rows[0]??null;}
  function wrote(result){if(result?.rowCount!==1)fail('OWNER_TRIAL_STORAGE_INVALID');}
  return {
    status(){return transaction(async client=>{const p=await policy(client);return state(client,p);});},
    claim(input){const id=identity(input);return transaction(async client=>{
      const p=await policy(client);
      if(await operation(client,id))fail('OWNER_TRIAL_DUPLICATE');
      const s=await state(client,p);if(!s.ready)fail(s.reason);
      wrote(await client.query(`INSERT INTO owner_refresh_trial_operations(account_id,trial_id,operation_id,market,utc_day,charged_credits,state)
        VALUES($1,$2::uuid,$3::uuid,$4,$5::date,1,'pending')`,[accountId,p.trial_id,id.operationId,id.market,p.utc_day]));
      return Object.freeze({accountId,trialId:p.trial_id,...id,reservedCredits:1});
    });},
    complete(input){const id=identity(input);const actual=input?.chargedCredits;
      if(!Number.isSafeInteger(actual)||actual<0)fail('OWNER_TRIAL_INPUT_INVALID');
      return transaction(async client=>{
        const r=await operation(client,id);if(!r)fail('OWNER_TRIAL_OPERATION_REQUIRED');
        if(r.state==='unknown')fail('OWNER_TRIAL_UNRESOLVED');
        if(!['pending','completed'].includes(r.state))fail('OWNER_TRIAL_STORAGE_INVALID');
        const charge=Math.max(1,integer(r.charged_credits),actual);
        // An unexpected charge must block the next claim atomically, not after the
        // caller receives this result: another worker may already be waiting.
        const nextState=charge>1?'unknown':'completed';
        wrote(await client.query(`UPDATE owner_refresh_trial_operations SET charged_credits=$4,state=$5,completed_at=clock_timestamp()
          WHERE account_id=$1 AND operation_id=$2::uuid AND market=$3`,[accountId,id.operationId,id.market,charge,nextState]));
        return nextState==='unknown'?{completed:false,unknown:true,blocked:true,chargedCredits:charge}:{completed:true,chargedCredits:charge};
      });},
    failUnknown(input){const id=identity(input);return transaction(async client=>{
      const r=await operation(client,id);if(!r)fail('OWNER_TRIAL_OPERATION_REQUIRED');
      if(!['pending','unknown','completed'].includes(r.state))fail('OWNER_TRIAL_STORAGE_INVALID');
      wrote(await client.query(`UPDATE owner_refresh_trial_operations SET state='unknown',completed_at=clock_timestamp()
        WHERE account_id=$1 AND operation_id=$2::uuid AND market=$3`,[accountId,id.operationId,id.market]));
      return {unknown:true,blocked:true};
    });}
  };
}
