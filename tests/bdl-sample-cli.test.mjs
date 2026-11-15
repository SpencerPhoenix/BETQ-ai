// Synthetic transport only. No provider request is issued; private RSA keys never leave memory.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,stat,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runBdlSampleCli} from '../scripts/collect-bdl-sample.mjs';
import {decryptBdlPrivateEnvelope} from '../src/bdl-private-envelope.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:3072}),pem=pair.publicKey.export({format:'pem',type:'spki'});
const root=fileURLToPath(new URL('../',import.meta.url)),journalPath=join(root,'data/evidence/nfl-2026.json');
const KEY='SYNTHETIC_ENV_SECRET_NEVER_STORE',PRIVATE='SYNTHETIC_PROVIDER_PRIVATE_TEXT';
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('UNEXPECTED_REAL_NETWORK_REQUEST');};
after(()=>{globalThis.fetch=originalFetch;});
async function setup(t){
  const directory=await mkdtemp(join(tmpdir(),'betq-private-sample-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const publicPath=join(directory,'recipient.pem');await writeFile(publicPath,pem);
  const journal=JSON.parse(await readFile(journalPath,'utf8')),snapshot=journal.snapshots.find(s=>s.gameId==='2026_09_GB_NE');
  const event={id:9999001,home_team:{id:99901,abbreviation:snapshot.home},visitor_team:{id:99902,abbreviation:snapshot.away},
    season:2026,postseason:false,date:snapshot.commenceTime,status_state:'final',status:'Final',updated_at:'2026-11-09T02:00:00.000Z',
    home_team_score:27,visitor_team_score:17,privateText:PRIVATE};
  const csv=`game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\n${snapshot.gameId},2026,REG,${snapshot.gameDate},${snapshot.home},${snapshot.away},27,17,Home\n`;
  const responses=[()=>new Response(csv),()=>new Response(JSON.stringify({data:[event],meta:{per_page:100,next_cursor:null}})),()=>new Response(JSON.stringify({data:event}))];
  const calls=[],messages={stdout:'',stderr:''};const output=join(directory,'bundle');
  const argv=['--game-id',snapshot.gameId,'--recipient-public-key',publicPath,'--output',output];
  const dependencies={env:{BALLDONTLIE_API_KEY:KEY},clock:()=>Date.parse('2027-01-01T00:00:00.000Z'),
    fetchImpl:async(url,options)=>{calls.push({url,options});return responses.shift()();},
    stdout:s=>{messages.stdout+=s;},stderr:s=>{messages.stderr+=s;}};
  const run=(args=argv,extra={})=>runBdlSampleCli(args,{...dependencies,...extra});
  return {directory,publicPath,output,argv,dependencies,calls,responses,messages,event,journal,run};
}
test('Manual CLI stores only recipient-encrypted source bundle and bounded allowlisted summary',async t=>{
  const f=await setup(t),journalBefore=await readFile(journalPath),code=await f.run();assert.equal(code,0,f.messages.stderr);
  assert.equal(f.calls.length,3);assert.deepEqual((await readdir(f.output)).sort(),['envelope.json','summary.json']);
  assert.equal((await stat(f.output)).mode&0o777,0o700);
  const rawEnvelope=await readFile(join(f.output,'envelope.json'),'utf8'),rawSummary=await readFile(join(f.output,'summary.json'),'utf8');
  for(const name of ['envelope.json','summary.json'])assert.equal((await stat(join(f.output,name))).mode&0o777,0o600);
  const summary=JSON.parse(rawSummary);assert.equal(summary.bdlRequests,2);assert.equal(summary.publicRequests,1);
  assert.equal(summary.encryptedArtifactStored,true);assert.equal(summary.plaintextStored,false);assert.equal(summary.scoringEligible,false);
  assert.equal(summary.qualifiedOutcomes,0);assert.equal(summary.status,'ENCRYPTED_NONQUALIFYING_SAMPLE');
  assert.equal(summary.encryptedArtifactSha256,createHash('sha256').update(rawEnvelope).digest('hex'));
  assert.deepEqual(JSON.parse(f.messages.stdout),summary);assert.equal(f.messages.stderr,'');
  assert.doesNotMatch(rawEnvelope+rawSummary+f.messages.stdout,/SYNTHETIC_ENV_SECRET|SYNTHETIC_PROVIDER_PRIVATE|home_team_score|bodyBase64|gameId/);
  const bundle=decryptBdlPrivateEnvelope(JSON.parse(rawEnvelope),pair.privateKey);
  assert.deepEqual(bundle.journal,f.journal);assert.equal(bundle.ledger.entries.length,1);
  const source=bundle.ledger.archives.map(a=>Buffer.from(a.bodyBase64,'base64').toString()).join('\n');assert.match(source,/SYNTHETIC_PROVIDER_PRIVATE_TEXT/);
  assert.equal(JSON.stringify(bundle).includes(KEY),false);assert.deepEqual(await readFile(journalPath),journalBefore);
  for(const call of f.calls){assert.equal(call.url.includes(KEY),false);assert.equal(call.options.headers.Authorization,call.url.startsWith('https://api.balldontlie.io/')?KEY:undefined);}
});
test('No key, invalid key, weak RSA or absent env fail before any request and preserve sanitized failure summary',async t=>{
  for(const mode of ['missingPublic','badPublic','privatePem','weakPublic','missingEnv','emptyEnv','invalidEnv']){
    const f=await setup(t);let extra={};
    if(mode==='missingPublic')await rm(f.publicPath);
    if(mode==='badPublic')await writeFile(f.publicPath,PRIVATE);
    if(mode==='privatePem')await writeFile(f.publicPath,'-----BEGIN PRIVATE KEY-----\nFABRICATED-NOT-A-KEY\n-----END PRIVATE KEY-----\n');
    if(mode==='weakPublic')await writeFile(f.publicPath,generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'}));
    if(mode==='missingEnv')extra={env:{}};if(mode==='emptyEnv')extra={env:{BALLDONTLIE_API_KEY:''}};
    if(mode==='invalidEnv')extra={env:{BALLDONTLIE_API_KEY:KEY+'\n'}};
    assert.equal(await f.run(f.argv,extra),1);assert.equal(f.calls.length,0);
    assert.deepEqual(await readdir(f.output),['summary.json']);
    const summary=JSON.parse(await readFile(join(f.output,'summary.json'),'utf8'));
    assert.equal(summary.status,'SAMPLE_FAILED');assert.equal(summary.encryptedArtifactStored,false);assert.equal(summary.bdlRequests,0);
    assert.doesNotMatch(JSON.stringify(summary)+f.messages.stdout+f.messages.stderr,/SYNTHETIC_ENV_SECRET|SYNTHETIC_PROVIDER_PRIVATE|BEGIN PRIVATE|ENOENT|recipient.pem/);
  }
});
test('Provider failure retains sanitized diagnostics only, never error bodies, credentials or partial plaintext',async t=>{
  for(const body of [()=>new Response(KEY+' '+PRIVATE,{status:401}),()=>{throw Error(KEY+' '+PRIVATE);}]){
    const f=await setup(t);f.responses[1]=body;assert.equal(await f.run(),1);assert.equal(f.calls.length,2);
    assert.deepEqual(await readdir(f.output),['summary.json']);const raw=await readFile(join(f.output,'summary.json'),'utf8');
    assert.equal(JSON.parse(raw).bdlRequests,1);assert.doesNotMatch(raw+f.messages.stdout+f.messages.stderr,/SYNTHETIC_ENV_SECRET|SYNTHETIC_PROVIDER_PRIVATE/);
  }
});
test('Existing output is not overwritten and causes zero requests',async t=>{
  const f=await setup(t);assert.equal(await f.run(),0);const before=await readFile(join(f.output,'envelope.json'));
  f.calls.length=0;assert.equal(await f.run(),1);assert.equal(f.calls.length,0);
  assert.deepEqual(await readFile(join(f.output,'envelope.json')),before);assert.match(f.messages.stderr,/OUTPUT_EXISTS/);
});
test('Strict args reject credential flags, journal override, malformed IDs, duplicate flags, and URLs',async t=>{
  const f=await setup(t);
  for(const argv of [[],[...f.argv,'--api-key',KEY],[...f.argv,'--journal',journalPath],
    ['--game-id','bad','--recipient-public-key',f.publicPath,'--output',f.output],
    ['--game-id','2026_09_GB_NE','--game-id','2026_09_GB_NE','--output',f.output]])assert.equal(await f.run(argv),1);
  const urlArgs=[...f.argv];urlArgs[3]='https://example.invalid/key?secret='+KEY;assert.equal(await f.run(urlArgs),1);
  assert.equal(f.calls.length,0);assert.doesNotMatch(f.messages.stdout+f.messages.stderr,/SYNTHETIC_ENV_SECRET|example.invalid/);
});
test('Repository output and symlink input or output parents fail before requests',async t=>{
  const f=await setup(t),repoArgs=[...f.argv];repoArgs[5]=join(root,'untracked-encrypted-sample');
  assert.equal(await f.run(repoArgs),1);assert.match(f.messages.stderr,/OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  await symlink(f.directory,join(f.directory,'alias'));const outputArgs=[...f.argv];outputArgs[5]=join(f.directory,'alias/output');
  assert.equal(await f.run(outputArgs),1);
  const g=await setup(t);await symlink(g.publicPath,join(g.directory,'key-alias'));g.argv[3]=join(g.directory,'key-alias');assert.equal(await g.run(),1);
  assert.equal(f.calls.length+g.calls.length,0);assert.deepEqual(await readdir(g.output),['summary.json']);
});
test('Unknown or quarantined target fails without requests and never changes journal',async t=>{
  for(const gameId of ['2026_09_LV_SF','2026_20_GB_NE']){
    const f=await setup(t);f.argv[1]=gameId;assert.equal(await f.run(),1);assert.equal(f.calls.length,0);
    assert.equal(JSON.parse(await readFile(join(f.output,'summary.json'),'utf8')).error,'MISSING_OR_QUARANTINED_TARGET');
  }
});
test('Manual executable help and invalid-args paths do not request transport or read ambient key files',async t=>{
  const f=await setup(t),script=join(root,'scripts/collect-bdl-sample.mjs'),guard=join(f.directory,'deny-network.mjs');
  await writeFile(guard,"globalThis.fetch=()=>{throw Error('NETWORK_WAS_ATTEMPTED');};");
  for(const args of [['--help'],[]]){
    const result=spawnSync(process.execPath,['--import',guard,script,...args],{env:{PATH:process.env.PATH,HOME:f.directory},encoding:'utf8'});
    assert.equal(result.status,args.length?0:1);assert.doesNotMatch(result.stdout+result.stderr,/NETWORK_WAS_ATTEMPTED/);
  }
});

test('Credential-echo rejection remains a fixed safe error rather than source text',async t=>{
  const f=await setup(t);f.responses[0]=()=>new Response('SYNTHETIC_SOURCE_ECHO '+KEY);
  assert.equal(await f.run(),1);assert.equal(f.calls.length,1);
  const summary=JSON.parse(await readFile(join(f.output,'summary.json'),'utf8'));
  assert.equal(summary.error,'CREDENTIAL_ECHO_REJECTED');
  assert.doesNotMatch(JSON.stringify(summary)+f.messages.stdout+f.messages.stderr,/SYNTHETIC_ENV_SECRET|SYNTHETIC_SOURCE_ECHO/);
});
