/** Disabled durable owner session/rate stores. Inject a verified-TLS bounded pool.
 * No credentials, environment lookup, runtime schema migration or provider calls. */
import {createHash} from 'node:crypto';
import {guardPostgresClient} from './postgres-security.mjs';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const secret=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const digest=v=>createHash('sha256').update(v).digest('hex');
const fail=()=>{const e=new Error('Owner session storage unavailable.');e.code='OWNER_SESSION_STORAGE_UNAVAILABLE';throw e;};
const duration=900000,idle=300000;
function valid(r){return r&&hash(r.sessionHash)&&secret(r.csrfToken)&&r.revoked===false&&
  [r.createdAt,r.lastSeenAt,r.expiresAt].every(time)&&r.createdAt<=r.lastSeenAt&&
  r.lastSeenAt<r.expiresAt&&r.expiresAt>r.createdAt&&r.expiresAt-r.createdAt<=duration;}
function record(row){return {sessionHash:row.session_hash,userId:row.owner_id,csrfToken:row.csrf_token,
  createdAt:Number(row.created_at_ms),lastSeenAt:Number(row.last_seen_ms),expiresAt:Number(row.expires_at_ms),revoked:row.revoked};}
export function createOwnerSessionStores({enabled=false,pool,ownerId}={}){
  const configured=typeof ownerId==='string'&&ownerId.length>0&&ownerId.length<=128&&!/[\u0000-\u001f\u007f]/.test(ownerId)&&typeof pool?.connect==='function';
  async function tx(work){if(enabled!==true||!configured)fail();let guard;
    try{const client=await pool.connect();guard=guardPostgresClient(client);await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='1s'");await client.query("SET LOCAL statement_timeout='2s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('betq-owner-session:' || $1,0))",[ownerId]);
      const result=await work(client);await client.query('COMMIT');guard.assertHealthy();return result;
    }catch{if(guard)await guard.rollback();guard?.markFailed();fail();}
    finally{if(guard)try{guard.release();}catch{fail();}}
  }
  // PostgreSQL is authoritative. Caller time can only further deny, never revive.
  const dbNow=async c=>{const r=await c.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms');const n=Number(r.rows[0]?.now_ms);if(!time(n))fail();return n;};
  const load=async c=>(await c.query('SELECT * FROM owner_auth_sessions WHERE owner_id=$1',[ownerId])).rows[0]??null;
  const sessionStore=Object.freeze({
    replaceOwner(r){if(!valid(r)||r.userId!==ownerId||r.lastSeenAt!==r.createdAt)fail();
      return tx(async c=>{const old=await load(c),checked=await dbNow(c);
        if(r.createdAt>checked||checked-r.createdAt>5000||checked>=r.expiresAt||old?.session_hash===r.sessionHash)fail();
        if(old&&(!time(Number(old.high_water_ms))||checked<Number(old.high_water_ms)))fail();
        await c.query(`INSERT INTO owner_auth_sessions(owner_id,session_hash,csrf_token,created_at_ms,last_seen_ms,expires_at_ms,high_water_ms,revoked)
          VALUES($1,$2,$3,$4,$4,$5,$6,false) ON CONFLICT(owner_id) DO UPDATE SET
          session_hash=EXCLUDED.session_hash,csrf_token=EXCLUDED.csrf_token,created_at_ms=EXCLUDED.created_at_ms,
          last_seen_ms=EXCLUDED.last_seen_ms,expires_at_ms=EXCLUDED.expires_at_ms,high_water_ms=EXCLUDED.high_water_ms,revoked=false`,
          [ownerId,r.sessionHash,r.csrfToken,r.createdAt,r.expiresAt,checked]);return {stored:true};});
    },
    readAndTouch({sessionHash,now,idleMs}={}){if(!hash(sessionHash)||!time(now)||idleMs!==idle)fail();
      return tx(async c=>{const row=await load(c);if(!row)return null;const r=record(row),water=Number(row.high_water_ms),checked=await dbNow(c);
        if(!time(water)||checked<water||r.userId!==ownerId||r.sessionHash!==sessionHash)return null;
        // Retain observed DB time even on denial. Expiry permanently revokes without
        // touching lastSeenAt, so clock rollback cannot revive an observed expiry.
        const expired=checked>=r.expiresAt||checked-r.lastSeenAt>=idleMs;
        await c.query('UPDATE owner_auth_sessions SET high_water_ms=$2,revoked=revoked OR $3 WHERE owner_id=$1',[ownerId,checked,expired]);
        if(now<water||now>checked+1000||!valid(r)||r.lastSeenAt>checked||expired||now>=r.expiresAt||now-r.lastSeenAt>=idleMs)return null;
        await c.query('UPDATE owner_auth_sessions SET last_seen_ms=$2,high_water_ms=$2 WHERE owner_id=$1',[ownerId,checked]);
        return r; // Deliberately pre-touch, not the updated row.
      });
    },
    revoke({sessionHash,userId}={}){if(!hash(sessionHash)||userId!==ownerId)fail();
      return tx(async c=>{const row=await load(c);if(!row||row.session_hash!==sessionHash)return {revoked:false};
        await c.query('UPDATE owner_auth_sessions SET revoked=true WHERE owner_id=$1',[ownerId]);return {revoked:true};});
    }
  });
  const rules={'owner-login':['global',5],'owner-auth':['global',30],'owner-access':[configured?digest(ownerId):'',6],'owner-logout':['global',10]};
  const rateStore=Object.freeze({consume({scope,key,limit,windowMs}={}){
    if(!Object.hasOwn(rules,scope)||key!==rules[scope][0]||limit!==rules[scope][1]||windowMs!==60000)fail();
    return tx(async c=>{
      // DB clock and the persisted high-water reject rollback across app restarts.
      const clock=await c.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now_ms');
      const now=Number(clock.rows[0]?.now_ms);if(!time(now))fail();
      const row=(await c.query('SELECT * FROM owner_auth_rate WHERE owner_id=$1 AND scope=$2',[ownerId,scope])).rows[0];
      let start=now,count=0;
      if(row){const water=Number(row.high_water_ms);start=Number(row.window_start_ms);count=Number(row.used);
        if(!time(water)||!time(start)||!Number.isSafeInteger(count)||count<0||count>limit||start>water||now<water)fail();
        if(now-start>=windowMs){start=now;count=0;}}
      const allowed=count<limit;if(allowed)count++;
      await c.query(`INSERT INTO owner_auth_rate(owner_id,scope,window_start_ms,high_water_ms,used)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,scope) DO UPDATE SET
        window_start_ms=EXCLUDED.window_start_ms,high_water_ms=EXCLUDED.high_water_ms,used=EXCLUDED.used`,[ownerId,scope,start,now,count]);
      return {allowed};
    });
  }});
  return Object.freeze({sessionStore,rateStore});
}
