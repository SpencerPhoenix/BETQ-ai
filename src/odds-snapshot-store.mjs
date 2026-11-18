/** Private PostgreSQL snapshot adapter. Injected only: no environment, migration,
 * provider calls, quota authorization, or public-history endpoint. */
import {SPORTS, MARKETS, toDecimal} from './engine.mjs';
import {isProviderBudgetAccountId} from './provider-budget.mjs';

const fail=()=>{throw new Error('ODDS_SNAPSHOT_INVALID');};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v);
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&[new Date(Date.parse(v)).toISOString(),new Date(Date.parse(v)).toISOString().replace('.000Z','Z')].includes(v);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
export function validateOddsSnapshot(record,{accountId,cacheId,now=Date.now()}={}) {
  if(!Number.isSafeInteger(now)||!isProviderBudgetAccountId(accountId)||
    !keys(record,['version','accountId','cacheId','receivedAt','events'])||record.version!==1||
    record.accountId!==accountId||record.cacheId!==cacheId||!instant(record.receivedAt)||Date.parse(record.receivedAt)>now)fail();
  const parts=typeof cacheId==='string'?cacheId.split(':'):[];
  const [kind,sport,market]=parts;
  if(parts.length!==3||kind!=='odds'||!Object.hasOwn(SPORTS,sport)||!Object.hasOwn(MARKETS,market)||
    !Array.isArray(record.events)||record.events.length>1000||Buffer.byteLength(JSON.stringify(record))>5000000)fail();
  const ids=new Set();
  for(const e of record.events){
    if(!keys(e,['id','sport_key','sport_title','commence_time','home_team','away_team','bookmakers'])||
      !text(e.id)||ids.has(e.id)||e.sport_key!==sport||!text(e.home_team)||!text(e.away_team)||e.home_team===e.away_team||
      (e.sport_title!==undefined&&!text(e.sport_title))||!instant(e.commence_time)||!Array.isArray(e.bookmakers)||e.bookmakers.length>100)fail();
    ids.add(e.id); const books=new Set();
    for(const b of e.bookmakers){
      if(!keys(b,['key','title','last_update','markets'])||!text(b.key)||books.has(b.key)||!text(b.title)||
        (b.last_update!==undefined&&(!instant(b.last_update)||Date.parse(b.last_update)>Date.parse(record.receivedAt)))||!Array.isArray(b.markets)||b.markets.length!==1)fail();
      books.add(b.key);
      const m=b.markets[0];
      // Provider market timestamps supersede deprecated bookmaker timestamps.
      // Retain either supplied shape verbatim; never manufacture the other.
      // Legacy book-only storage does not establish market freshness for scoring.
      if(!keys(m,['key','last_update','outcomes'])||m.key!==market||(m.last_update!==undefined&&(!instant(m.last_update)||Date.parse(m.last_update)>Date.parse(record.receivedAt)))||
        (b.last_update===undefined&&m.last_update===undefined)||
        !Array.isArray(m.outcomes)||m.outcomes.length!==2)fail();
      const [a,z]=m.outcomes;
      for(const o of m.outcomes)if(!keys(o,['name','price','point'])||!text(o.name)||toDecimal(o.price)===null||
        (market==='h2h'?o.point!==undefined:!Number.isFinite(o.point)))fail();
      if(a.name===z.name||(market==='totals'?![a.name,z.name].includes('Over')||![a.name,z.name].includes('Under')||a.point!==z.point:
        ![a.name,z.name].includes(e.home_team)||![a.name,z.name].includes(e.away_team))||
        (market==='spreads'&&Math.abs(a.point+z.point)>0.001))fail();
    }
  }
  return structuredClone(record);
}

export function createOddsSnapshotStore({pool,accountId,clock=Date.now}={}) {
  if(!pool||typeof pool.query!=='function'||!isProviderBudgetAccountId(accountId))fail();
  return {
    async read(cacheId){
      const result=await pool.query('SELECT snapshot FROM betq_odds_snapshots WHERE account_id=$1 AND cache_id=$2',[accountId,cacheId]);
      if(!Array.isArray(result?.rows)||result.rows.length>1)fail();
      if(!result.rows.length)return null;
      return validateOddsSnapshot(result.rows[0].snapshot,{accountId,cacheId,now:clock()});
    },
    async write(cacheId,payload){
      const record=validateOddsSnapshot({version:1,accountId,cacheId,receivedAt:payload.receivedAt,events:payload.events},{accountId,cacheId,now:clock()});
      // Monotonic replacement: a slow writer may not replace a newer observation.
      // Equal-time conflicts keep the first observation; no quota is inferred here.
      const result=await pool.query(`INSERT INTO betq_odds_snapshots(account_id,cache_id,received_at,snapshot)
        VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(account_id,cache_id) DO UPDATE
        SET received_at=EXCLUDED.received_at,snapshot=EXCLUDED.snapshot
        WHERE betq_odds_snapshots.received_at < EXCLUDED.received_at`,[accountId,cacheId,record.receivedAt,JSON.stringify(record)]);
      if(![0,1].includes(result?.rowCount))fail();
      return {stored:result.rowCount===1};
    }
  };
}
