/**
 * BETQ private prospective QB-and-odds research store.
 *
 * Defaults OFF. Raw bookmaker odds and official article URLs are stored only
 * in a dedicated, access-controlled database. Public GitHub artifacts hold
 * code and aggregate research, not vendor observations.
 */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {SHADOW_SCHEMA,normalizeOwnedOddsSnapshot} from './shadow-latency.mjs';

const DISABLED_REASON='DEDICATED_PRIVATE_DURABLE_DATABASE_NOT_CONFIGURED';
const baseStatus=()=>({
  schema:1,version:SHADOW_SCHEMA,
  available:false,captureEnabled:false,durableStorage:false,
  reason:DISABLED_REASON,
  providerHistoricalBackfillEnabled:false,sourcePublicationTimeVerified:false,
  verifiedStartingQB:false,noAutomaticProviderPolling:true,
  rawBookmakerQuotesExposed:false,bookmakerExecutionVerified:false,
  realMoneyROI:null,verifiedCLV:null,wageringAuthorized:false
});
export function disabledShadowStore(){
  return {
    async status(){return baseStatus();},
    async capture(){return {captured:false,reason:DISABLED_REASON,inserted:0};},
    async analysis(){return {...baseStatus(),studyMode:'NO_PRIVATE_DATA'};}
  };
}

const statusSQL=[
  'SELECT',
  '(SELECT count(*)::int FROM betq_shadow.quote_observations) AS quote_rows,',
  '(SELECT count(*)::int FROM betq_shadow.qb_news_candidates) AS qb_candidates,',
  '(SELECT count(*)::int FROM betq_shadow.qb_source_reviews) AS qb_reviews'
].join(' ');

const insertQuoteSQL=[
  'INSERT INTO betq_shadow.quote_observations(',
  'record_id,sport,event_id,home_team,away_team,kickoff_at,',
  'market,period,bookmaker_key,home_american,away_american,',
  'source_market_updated_at,first_observed_at,fair_home_probability,payload_digest)',
  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
  'ON CONFLICT(record_id) DO NOTHING'
].join(' ');

const insertCandidateSQL=[
  'INSERT INTO betq_shadow.qb_news_candidates(',
  'record_id,event_id,team,qb_name,report_status,source_url,',
  'source_kind,kickoff_at,first_observed_at,publisher_claimed_at)',
  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  'ON CONFLICT(record_id) DO NOTHING'
].join(' ');

const insertReviewSQL=[
  'INSERT INTO betq_shadow.qb_source_reviews(',
  'candidate_record_id,reviewer_id,reviewed_at,source_evidence_digest)',
  'VALUES ($1,$2,$3,$4)',
  'ON CONFLICT(candidate_record_id) DO NOTHING'
].join(' ');

/**
 * SQL connection deliberately injected. Never initialize the database
 * automatically from a public GET endpoint.
 */
export function postgresShadowStore(pool){
  if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')
    throw Error('Private PostgreSQL pool required');
  return {
    async status(){
      try{
        const response=await pool.query(statusSQL);
        const row=response.rows?.[0]||{};
        return {
          ...baseStatus(),
          available:true,captureEnabled:true,durableStorage:true,
          reason:'PRIVATE_DATABASE_REACHABLE',
          recordedQuoteRevisions:Number(row.quote_rows)||0,
          QBNewsCandidates:Number(row.qb_candidates)||0,
          independentlyReviewedQBEvents:Number(row.qb_reviews)||0,
          dataProvenance:'OWN_COLLECTOR_FIRST_OBSERVED'
        };
      }catch{
        return {...baseStatus(),reason:'PRIVATE_DATABASE_UNAVAILABLE'};
      }
    },
    /** Read provider-owned snapshot, never user-provided HTTP POST. */
    async capture(snapshot,{now=Date.now()}={}){
      const normalized=normalizeOwnedOddsSnapshot(snapshot,{now});
      if(!normalized.records.length)return {
        captured:false,inserted:0,rejected:normalized.rejected,
        reason:normalized.reason
      };
      const client=await pool.connect();
      let inserted=0;
      try{
        await client.query('BEGIN');
        for(const r of normalized.records){
          const result=await client.query(insertQuoteSQL,[
            r.recordId,r.sport,r.eventId,r.homeTeam,r.awayTeam,
            r.kickoffAt,r.market,r.period,r.bookmakerKey,
            r.homeAmerican,r.awayAmerican,r.sourceMarketUpdatedAt,
            r.firstObservedAt,r.fairHomeProbability,r.payloadDigest
          ]);
          inserted+=result.rowCount||0;
        }
        await client.query('COMMIT');
        return {captured:true,inserted,rejected:normalized.rejected,
          sourceStatus:'PRIVATE_SOURCE_OBSERVATION_NOT_EXECUTABLE'};
      }catch{
        await client.query('ROLLBACK').catch(()=>{});
        throw Error('PRIVATE_SHADOW_WRITE_FAILED');
      }finally{client.release();}
    },
    async appendQBCandidate(r){
      if(r?.schema!==SHADOW_SCHEMA||
         r.verificationStatus!=='AWAITING_INDEPENDENT_SOURCE_REVIEW')
        throw Error('Invalid unreviewed QB news candidate');
      const result=await pool.query(insertCandidateSQL,[
        r.recordId,r.eventId,r.team,r.qbName,r.status,
        r.sourceUrl,r.sourceKind,r.kickoffAt,
        r.firstObservedAt,r.sourcePublishedAt
      ]);
      return {inserted:result.rowCount||0,status:'AWAITING_REVIEW'};
    },
    async appendQBReview(r){
      if(r?.reviewStatus!=='OFFICIAL_SOURCE_REVIEWED'||
         r.determination!=='SOURCE_REVIEW_ONLY_NOT_STARTER_CERTAINTY')
        throw Error('Invalid private source review');
      const result=await pool.query(insertReviewSQL,[
        r.recordId,r.reviewerId,r.reviewedAt,r.sourceEvidenceDigest
      ]);
      return {inserted:result.rowCount||0,status:'SOURCE_REVIEWED_NOT_QB_CERTAINTY'};
    },
    /**
     * No raw quote or source URL is ever served publicly.
     * A controlled study is embargoed until reviewed events and matched no-news
     * controls accumulate; do not manufacture a quick latency estimate.
     */
    async analysis(){
      const status=await this.status();
      if(!status.available)return {...status,studyMode:'NO_PRIVATE_DATA'};
      return {
        schema:1,version:SHADOW_SCHEMA,
        available:false,captureEnabled:true,durableStorage:true,
        reason:'NO_SOURCE_REVIEWED_MATCHED_CONTROL_COHORT_YET',
        recordedQuoteRevisions:status.recordedQuoteRevisions,
        QBNewsCandidates:status.QBNewsCandidates,
        independentlyReviewedQBEvents:status.independentlyReviewedQBEvents,
        studyMode:'SOURCE_REVIEW_AND_CONTROL_GATES_UNFULFILLED',
        rawBookmakerQuotesExposed:false,sourceURLsExposed:false,
        firstPublicationVerified:false,realMoneyROI:null,verifiedCLV:null,
        wageringAuthorized:false,causalityEstablished:false
      };
    }
  };
}

/**
 * Live capture needs three deliberate config settings AND a dedicated DB.
 * The absence of any setting is OFF (including on the existing Render service).
 */
export function configuredShadowStore({
  env=process.env,clientFactory=null
}={}){
  const allowed=env.BETQ_SHADOW_CAPTURE_ENABLED==='true'&&
    env.BETQ_SHADOW_LICENSE_REVIEWED==='true'&&
    typeof env.BETQ_SHADOW_DATABASE_URL==='string'&&
    env.BETQ_SHADOW_DATABASE_URL.length>=24;
  if(!allowed)return disabledShadowStore();
  let pool=null,store=null,promise=null;
  async function get(){
    if(store)return store;
    if(!promise)promise=(async()=>{
      const driver=clientFactory?await clientFactory():
        await import('pg').then(x=>x.default||x);
      pool=typeof driver.connect==='function'&&typeof driver.query==='function'?
        driver:new driver.Pool({
          connectionString:env.BETQ_SHADOW_DATABASE_URL,
          ssl:{rejectUnauthorized:true},max:3,
          connectionTimeoutMillis:3000,idleTimeoutMillis:10000
        });
      const active=postgresShadowStore(pool);
      const health=await active.status();
      if(!health.available)throw Error('SHADOW_SCHEMA_NOT_READY');
      store=active;return active;
    })().catch(e=>{promise=null;throw e;});
    return promise;
  }
  return {
    async status(){
      try{return await(await get()).status();}
      catch{return {...baseStatus(),reason:'PRIVATE_STORE_NOT_READY'};}
    },
    async capture(snapshot,opts){
      try{return await(await get()).capture(snapshot,opts);}
      catch{return {captured:false,inserted:0,reason:'PRIVATE_CAPTURE_FAILED'};}
    },
    async analysis(){
      try{return await(await get()).analysis();}
      catch{return {...baseStatus(),reason:'PRIVATE_STUDY_NOT_READY'};}
    }
  };
}

/** Maintenance CLI ONLY. Never called automatically by server. */
export async function applyPrivateSchema(pool){
  if(typeof pool?.query!=='function')throw Error('Private pool required');
  const file=resolve(dirname(fileURLToPath(import.meta.url)),
    '../sql/shadow-private.sql');
  await pool.query(await readFile(file,'utf8'));
  return {schema:SHADOW_SCHEMA,applied:true,publicWriteEndpoints:false};
}
