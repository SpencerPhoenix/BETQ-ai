#!/usr/bin/env node
/**
 * Private operator CLI. NOT used by public BETQ API or GitHub Actions.
 * Example: BETQ_SHADOW_DATABASE_URL=... node scripts/shadow-private-cli.mjs init
 *
 * The "ingest" subcommand measures FIRST SEEN at execution time.
 * It never trusts a timestamp supplied in the input file as capture time.
 * "review" requires a human reviewer and source evidence file; it is
 * not equivalent to verified starter selection or actual betting.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {applyPrivateSchema,postgresShadowStore} from '../src/shadow-store.mjs';
import {makeQBCandidateNews,reviewQBCandidate} from '../src/shadow-latency.mjs';

const command=process.argv[2];
if(!['init','ingest','review','status'].includes(command))
  throw Error('Only init, ingest, review or status private commands are allowed.');
const u=process.env.BETQ_SHADOW_DATABASE_URL;
if(process.env.BETQ_SHADOW_LICENSE_REVIEWED!=='true'||
   typeof u!=='string'||!/^postgres(?:ql)?:\/\//.test(u))
  throw Error('Dedicated private database and source license review required.');
let name='';
try{name=decodeURIComponent(new URL(u).pathname.slice(1));}catch{}
if(!/^betq_[a-z0-9_]{2,60}$/.test(name))
  throw Error('Refusing non-BETQ database; name must begin betq_.');
const pkg=await import('pg');
const {Pool}=pkg.default||pkg;
const pool=new Pool({
  connectionString:u,
  ssl:{rejectUnauthorized:true},max:2,
  connectionTimeoutMillis:3000
});
try{
  if(command==='init'){
    await applyPrivateSchema(pool);
    console.log('BETQ dedicated private schema initialized; no bookmaker API requests.');
  }else{
    const store=postgresShadowStore(pool);
    const status=await store.status();
    if(!status.available)throw Error('Private schema unavailable; use init.');
    if(command==='status'){
      console.log(JSON.stringify(status,null,2));
    }else if(command==='ingest'){
      const path=process.argv[3];
      if(!path)throw Error('Provide local private JSON candidate path.');
      const buffer=await readFile(path);
      if(buffer.length>12000)throw Error('QB candidate file too large.');
      const candidate=makeQBCandidateNews(JSON.parse(buffer.toString('utf8')),{
        observedAt:Date.now()
      });
      const r=await store.appendQBCandidate(candidate);
      console.log(JSON.stringify({
        candidateId:candidate.recordId,...r,
        firstObservedAt:candidate.firstObservedAt,
        publicationTimestampVerified:false
      },null,2));
    }else if(command==='review'){
      const recordId=process.argv[3],evidenceFile=process.argv[4];
      const reviewerId=process.env.BETQ_SHADOW_HUMAN_REVIEWER;
      if(!/^[a-f0-9]{64}$/.test(recordId||'')||!evidenceFile||
         !reviewerId)throw Error('Provide candidate digest, local evidence file and reviewer.');
      const query=await pool.query(
        'SELECT record_id,first_observed_at FROM betq_shadow.qb_news_candidates WHERE record_id=$1',
        [recordId]
      );
      if(query.rows.length!==1)throw Error('Candidate not found in private archive.');
      const candidate={
        schema:'betq-shadow-v1',recordId,
        verificationStatus:'AWAITING_INDEPENDENT_SOURCE_REVIEW',
        firstObservedAt:new Date(query.rows[0].first_observed_at).toISOString()
      };
      const evidence=await readFile(evidenceFile);
      if(!evidence.length||evidence.length>200000)
        throw Error('Invalid locally inspected official source content.');
      const review=reviewQBCandidate(candidate,{
        reviewerId,reviewedAt:Date.now(),
        sourceEvidenceDigest:createHash('sha256').update(evidence).digest('hex')
      });
      const r=await store.appendQBReview(review);
      console.log(JSON.stringify({
        candidateId:recordId,...r,
        reviewedAt:review.reviewedAt,
        disclaimer:'Official source reviewed by a human; not a certified bookmaker signal.'
      },null,2));
    }
  }
}finally{await pool.end();}
