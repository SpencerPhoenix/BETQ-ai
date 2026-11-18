/** Opt-in, lazy private storage only. Never migrates, seeds quota or calls a provider. */
import {createOddsSnapshotStore} from './odds-snapshot-store.mjs';
import {isProviderBudgetAccountId} from './provider-budget.mjs';
import {verifiedPostgresOptions,handleIdlePoolErrors} from './postgres-security.mjs';

const failure=code=>Object.assign(new Error('Private odds storage is unavailable.'),{code});
export function configuredOddsSnapshotStore({env=process.env,clientFactory,clock=Date.now}={}) {
  const enabled=env.BETQ_ODDS_SNAPSHOTS_ENABLED;
  if(enabled===undefined||enabled==='false')return null;
  const accountId=env.BETQ_BUDGET_ACCOUNT_ID;
  let configurationError=null,options;
  if(enabled!=='true'||!isProviderBudgetAccountId(accountId))configurationError='ODDS_SNAPSHOT_CONFIGURATION_INVALID';
  else{
    try{options=verifiedPostgresOptions(env.BETQ_ODDS_SNAPSHOT_DATABASE_URL);}
    catch{configurationError='ODDS_SNAPSHOT_CONFIGURATION_INVALID';}
  }
  let pending;
  async function get(){
    if(configurationError)throw failure(configurationError);
    if(!pending)pending=(async()=>{
      const driver=clientFactory?await clientFactory():await import('pg').then(x=>x.default||x);
      const pool=handleIdlePoolErrors(new driver.Pool({...options,max:3,
        connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:5000,
        statement_timeout:5000,lock_timeout:3000,allowExitOnIdle:true}));
      return createOddsSnapshotStore({pool,accountId,clock});
    })().catch(()=>{pending=null;throw failure('ODDS_SNAPSHOT_STORAGE_UNAVAILABLE');});
    return pending;
  }
  async function invoke(method,args){
    try{return await(await get())[method](...args);}
    catch{throw failure(configurationError||'ODDS_SNAPSHOT_STORAGE_UNAVAILABLE');}
  }
  return Object.freeze({configurationError,
    read(cacheId){return invoke('read',[cacheId]);},
    write(cacheId,payload){return invoke('write',[cacheId,payload]);}
  });
}
