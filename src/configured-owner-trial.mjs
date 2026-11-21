/** Explicit opt-in only: no ambient env, migrations, policy seeds or provider calls. */
import {createOwnerTrialStore, OwnerTrialError} from './owner-trial-store.mjs';
import {isProviderBudgetAccountId} from './provider-budget.mjs';
import {verifiedPostgresOptions,handleIdlePoolErrors} from './postgres-security.mjs';
export function configuredOwnerTrial({enabled=false,accountId,connectionString,clientFactory}={}) {
  let pending;
  async function get(){
    if(enabled!==true)throw new OwnerTrialError('OWNER_TRIAL_DISABLED');
    if(!isProviderBudgetAccountId(accountId))throw new OwnerTrialError('OWNER_TRIAL_CONFIG_INVALID');
    let options;
    try{options=verifiedPostgresOptions(connectionString);}catch{throw new OwnerTrialError('OWNER_TRIAL_CONFIG_INVALID');}
    if(!pending)pending=(async()=>{
      const driver=clientFactory?await clientFactory():await import('pg').then(x=>x.default||x);
      // Only constructors are injectable. A prebuilt pool cannot bypass TLS/bounds.
      if(typeof driver?.Pool!=='function')throw Error();
      const pool=handleIdlePoolErrors(new driver.Pool({...options,max:3,
        connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:5000}));
      return createOwnerTrialStore({pool,accountId,enabled:true});
    })().catch(()=>{pending=null;throw new OwnerTrialError('OWNER_TRIAL_STORAGE_UNAVAILABLE');});
    return pending;
  }
  return Object.fromEntries(['status','claim','complete','failUnknown'].map(method=>[
    method,async input=>(await get())[method](input)
  ]));
}
