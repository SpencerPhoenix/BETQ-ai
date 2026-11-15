/** Database URLs cannot replace the application's verified TLS configuration. */
export function verifiedPostgresOptions(connectionString) {
  try {
    if(process.env.NODE_PG_FORCE_NATIVE)throw Error();
    if(typeof connectionString!=='string'||connectionString.length>8192)throw Error();
    const url=new URL(connectionString);
    // node-postgres merges URL query options over explicit Pool options. Never
    // hand it the URI; reject all query/fragment overrides instead of silently
    // accepting a request to disable TLS, certificate checks or hostname checks.
    if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||
      !url.hostname||url.hostname.includes('%')||url.pathname.length<2)throw Error();
    const host=url.hostname.replace(/^\[(.*)\]$/,'$1');
    if(/[\/\\\s\u0000-\u001f\u007f]/.test(host))throw Error();
    const database=decodeURIComponent(url.pathname.slice(1));
    const user=url.username?decodeURIComponent(url.username):undefined;
    const password=url.password?decodeURIComponent(url.password):undefined;
    const port=url.port?Number(url.port):5432;
    if(!Number.isInteger(port)||port<1||port>65535||
      [database,user,password].some(value=>value!==undefined&&/[\u0000-\u001f\u007f]/.test(value)))throw Error();
    return {host,port,database,...(user===undefined?{}:{user}),...(password===undefined?{}:{password}),
      ssl:{rejectUnauthorized:true},sslnegotiation:'postgres'};
  } catch {
    // Do not include the URI or the native URL error (which may contain secrets).
    const error=new Error('PostgreSQL requires a TCP URL without query or fragment overrides and verified TLS.');
    error.code='POSTGRES_TLS_CONFIGURATION_INVALID';
    throw error;
  }
}

const guardedPools=new WeakSet();
export function handleIdlePoolErrors(pool) {
  if(pool&&typeof pool.on==='function'&&!guardedPools.has(pool)){
    // pg removes a failed idle client. Without an error listener EventEmitter
    // terminates the process. Every following operation must still connect and
    // verify durable state; this handler neither retries nor authorizes spend.
    pool.on('error',()=>{});
    guardedPools.add(pool);
  }
  return pool;
}


/** A checked-out pg Client emits errors independently of its Pool. */
export function guardPostgresClient(client) {
  let failed=false,released=false;
  const onError=()=>{failed=true;};
  if(typeof client.on==='function')client.on('error',onError);
  return {
    get failed(){return failed;},
    markFailed(){failed=true;},
    assertHealthy(){if(failed)throw Error('PostgreSQL connection failed during transaction.');},
    async rollback(){
      if(!failed){try{await client.query('ROLLBACK');}catch{failed=true;}}
    },
    release(){
      if(released)return;
      released=true;
      try{client.release(failed);}
      catch{failed=true;throw Error('PostgreSQL client release failed.');}
      finally{
        // Discarded connections may emit a delayed error after a query rejects.
        // Keep their listener until the discarded object is garbage-collected.
        // Healthy release installs pg's idle listener before we remove ours.
        if(!failed&&typeof client.removeListener==='function')client.removeListener('error',onError);
      }
    }
  };
}
