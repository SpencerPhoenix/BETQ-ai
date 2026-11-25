/** Unwired owner-auth storage: explicit configuration, no environment or provisioning. */
import {createOwnerSessionStores} from './owner-session-store.mjs';
import {verifiedPostgresOptions,handleIdlePoolErrors} from './postgres-security.mjs';
function unavailable(code){const error=new Error('Owner authentication storage is unavailable.');error.code=code;return error;}
export function configuredOwnerSessionStores({enabled=false,ownerId,connectionString,clientFactory}={}){
  let pending;
  async function get(){
    if(enabled!==true)throw unavailable('OWNER_AUTH_STORAGE_DISABLED');
    if(typeof ownerId!=='string'||!ownerId||ownerId.length>128||/[\u0000-\u001f\u007f]/.test(ownerId))throw unavailable('OWNER_AUTH_STORAGE_CONFIG_INVALID');
    let options;try{options=verifiedPostgresOptions(connectionString);}catch{throw unavailable('OWNER_AUTH_STORAGE_CONFIG_INVALID');}
    if(!pending)pending=(async()=>{
      const driver=clientFactory?await clientFactory():await import('pg').then(x=>x.default||x);
      if(typeof driver?.Pool!=='function')throw Error();
      const pool=handleIdlePoolErrors(new driver.Pool({...options,max:3,
        connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:5000}));
      return createOwnerSessionStores({enabled:true,pool,ownerId});
    })().catch(()=>{pending=null;throw unavailable('OWNER_AUTH_STORAGE_UNAVAILABLE');});
    return pending;
  }
  return Object.freeze({
    sessionStore:Object.freeze(Object.fromEntries(['replaceOwner','readAndTouch','revoke'].map(method=>[
      method,async input=>(await get()).sessionStore[method](input)
    ]))),
    rateStore:Object.freeze({consume:async input=>(await get()).rateStore.consume(input)})
  });
}
