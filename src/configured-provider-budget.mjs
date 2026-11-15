/** Lazy, fail-closed production budget configuration. No schema creation or quota seeding. */
import {createProviderBudget, ProviderBudgetError, isProviderBudgetAccountId} from './provider-budget.mjs';
import {verifiedPostgresOptions,handleIdlePoolErrors} from './postgres-security.mjs';

export function configuredProviderBudget({env=process.env, clientFactory}={}) {
  const accountId=env.BETQ_BUDGET_ACCOUNT_ID;
  const connectionString=env.BETQ_BUDGET_DATABASE_URL;
  const configured=isProviderBudgetAccountId(accountId) &&
    typeof connectionString==='string' && /^postgres(?:ql)?:\/\//.test(connectionString);
  let pending;
  async function get(){
    if(!configured)throw new ProviderBudgetError('DURABLE_BUDGET_REQUIRED',
      'Paid refresh requires a configured durable credit ledger.',503);
    let databaseOptions;
    try{databaseOptions=verifiedPostgresOptions(connectionString);}
    catch{throw new ProviderBudgetError('BUDGET_DATABASE_CONFIGURATION_INVALID',
      'Database URL overrides are not allowed. Verified PostgreSQL TLS is required.',503);}
    if(!pending)pending=(async()=>{
      const driver=clientFactory ? await clientFactory() : await import('pg').then(x=>x.default||x);
      const pool=handleIdlePoolErrors(typeof driver.connect==='function' && typeof driver.query==='function' ? driver :
        new driver.Pool({...databaseOptions,max:3,
          connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:5000}));
      return createProviderBudget({pool,accountId,
        dailyCreditCap:env.ODDS_DAILY_CREDIT_LIMIT===undefined?12:env.ODDS_DAILY_CREDIT_LIMIT,
        reserveCredits:env.ODDS_MIN_CREDITS_RESERVE===undefined?50:env.ODDS_MIN_CREDITS_RESERVE,
        // Explicit null prevents an injected env from inheriting ambient process configuration.
        baselineMaxAgeSeconds:env.BETQ_BUDGET_BASELINE_MAX_AGE_SECONDS??null});
    })().catch(()=>{pending=null;throw new ProviderBudgetError('DURABLE_BUDGET_UNAVAILABLE',
      'Durable credit ledger is unavailable. No provider request was authorized.',503);});
    return pending;
  }
  return {
    async reserve(input){return (await get()).reserve(input);},
    async reconcile(reservation,quota){return (await get()).reconcile(reservation,quota);},
    async status(){
      try{return await(await get()).status();}
      catch(error){return {persistent:configured,available:false,ready:false,
        reason:error.code||'DURABLE_BUDGET_UNAVAILABLE',used:null,limit:null,
        providerRemaining:null,minimumProviderCredits:null};}
    }
  };
}
