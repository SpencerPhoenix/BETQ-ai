#!/usr/bin/env node
/** No capture or writes. Opt in only to replay the repository's synthetic fixture. */
import {readFile} from 'node:fs/promises';
import {createSyntheticEvidenceArchive,replaySyntheticEvidence} from '../src/evidence-archive.mjs';

const args=process.argv.slice(2);
if(args.length===0){
  console.log(JSON.stringify(createSyntheticEvidenceArchive().status(),null,2));
}else{
  if(args.length!==1||args[0]!=='--synthetic-fixture')throw Error('ONLY_--synthetic-fixture_SUPPORTED');
  // The reviewed repository version is the trust anchor for this fabricated
  // fixture. Do not derive the expected digest from the imported bundle itself.
  const expectedManifestSha256='2a8b8da0cb3f61fc0cd03afb29fec2f17d02377afc4894f03874b2e943b34b9b';
  const path=new URL('../tests/fixtures/evidence-archive/synthetic-v1.json',import.meta.url);
  const bundle=JSON.parse(await readFile(path,'utf8'));
  const report=replaySyntheticEvidence(bundle,{expectedManifestSha256});
  console.log(JSON.stringify({...report,fixtureOrigin:'FABRICATED_REPOSITORY_FIXTURE',
    filesWritten:0,productionEvidenceChanged:false},null,2));
}
