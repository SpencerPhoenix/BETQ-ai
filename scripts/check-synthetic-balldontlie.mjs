#!/usr/bin/env node
/** Fixed fabricated fixture only. No network, source activation, journal writes or secrets. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {crossCheckSyntheticBallDontLieFixture} from '../src/synthetic-balldontlie.mjs';

const args=process.argv.slice(2);
if(args.length===0){
  console.log(JSON.stringify(crossCheckSyntheticBallDontLieFixture(),null,2));
}else{
  if(args.length!==1||args[0]!=='--synthetic-fixture')throw Error('ONLY_--synthetic-fixture_SUPPORTED');
  const text=await readFile(new URL('../tests/fixtures/balldontlie/synthetic-nfl-v1.json',import.meta.url),'utf8');
  const expected='b8fbb06a73da0ea679940a9283696baccfca1a3e790fa010df7f52dd4558493c';
  if(createHash('sha256').update(text).digest('hex')!==expected)throw Error('REVIEWED_SYNTHETIC_FIXTURE_DIGEST_MISMATCH');
  console.log(JSON.stringify(crossCheckSyntheticBallDontLieFixture(JSON.parse(text),{enabled:true}),null,2));
}
