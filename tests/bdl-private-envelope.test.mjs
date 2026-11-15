// Ephemeral test-only RSA keys are generated in memory, never persisted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {BDL_PRIVATE_ENVELOPE_POLICY,validateBdlRecipientPublicKey,encryptBdlPrivateBundle,decryptBdlPrivateEnvelope} from '../src/bdl-private-envelope.mjs';
const pair=generateKeyPairSync('rsa',{modulusLength:3072});
const pem=pair.publicKey.export({format:'pem',type:'spki'});
const bundle=()=>({schema:1,synthetic:true,privateBytesBase64:Buffer.from('SYNTHETIC_PROVIDER_BODY_NOT_FOR_PUBLIC_ARTIFACT').toString('base64'),
  privateData:'SYNTHETIC_PRIVATE_BUNDLE',nested:{scores:[27,17],nonqualifying:true}});
const changed=s=>{const b=Buffer.from(s,'base64');b[0]^=1;return b.toString('base64');};

test('RSA3072 public key fingerprint is stable and derived only from public SPKI bytes',()=>{
  const validated=validateBdlRecipientPublicKey(pem);
  assert.equal(validated.modulusLength,3072);assert.equal(validated.publicKey.type,'public');
  assert.equal(validated.recipientKeySha256,createHash('sha256').update(pair.publicKey.export({format:'der',type:'spki'})).digest('hex'));
});
test('Authenticated hybrid envelope roundtrips exact JSON and exposes no plaintext or source identifiers',()=>{
  const input=bundle(),before=structuredClone(input),envelope=encryptBdlPrivateBundle(input,pem);
  assert.equal(envelope.policy,BDL_PRIVATE_ENVELOPE_POLICY);assert.equal(envelope.contentEncryption,'AES-256-GCM');
  assert.equal(envelope.keyWrapping,'RSA-OAEP-SHA256');assert.equal(Buffer.from(envelope.ivBase64,'base64').length,12);
  assert.equal(Buffer.from(envelope.authTagBase64,'base64').length,16);assert.equal(Buffer.from(envelope.wrappedKeyBase64,'base64').length,384);
  assert.deepEqual(decryptBdlPrivateEnvelope(envelope,pair.privateKey),input);assert.deepEqual(input,before);
  assert.doesNotMatch(JSON.stringify(envelope),/SYNTHETIC|privateData|privateBytesBase64|scores/);
});
test('Repeated encryption uses different AES keys, IVs, ciphertext and authenticated tags',()=>{
  const a=encryptBdlPrivateBundle(bundle(),pem),b=encryptBdlPrivateBundle(bundle(),pem);
  for(const field of ['ivBase64','wrappedKeyBase64','ciphertextBase64','authTagBase64'])assert.notEqual(a[field],b[field]);
  assert.equal(a.recipientKeySha256,b.recipientKeySha256);assert.deepEqual(decryptBdlPrivateEnvelope(b,pair.privateKey),bundle());
});
for(const field of ['ivBase64','wrappedKeyBase64','ciphertextBase64','authTagBase64'])test('Tampering is rejected before plaintext return: '+field,()=>{
  const envelope=encryptBdlPrivateBundle(bundle(),pem);envelope[field]=changed(envelope[field]);
  assert.throws(()=>decryptBdlPrivateEnvelope(envelope,pair.privateKey),/^Error: PRIVATE_ENVELOPE_DECRYPTION_FAILED$/);
});
test('Metadata, recipient, unknown fields, truncation and noncanonical base64 fail closed',()=>{
  const original=encryptBdlPrivateBundle(bundle(),pem);
  for(const change of [e=>e.schema=2,e=>e.policy='FAKE',e=>e.contentEncryption='AES-256-CBC',e=>e.keyWrapping='RSA-PKCS1',
    e=>e.meaning='OFFICIAL',e=>e.recipientKeySha256='f'.repeat(64),e=>e.extra='PRIVATE_TEXT',
    e=>e.ciphertextBase64=e.ciphertextBase64.slice(0,-4),e=>e.ivBase64+=' ',e=>e.authTagBase64='']){
    const envelope=structuredClone(original);change(envelope);assert.throws(()=>decryptBdlPrivateEnvelope(envelope,pair.privateKey),/PRIVATE_ENVELOPE_DECRYPTION_FAILED/);
  }
});
test('Wrong recipient private key and public-only key cannot decrypt',()=>{
  const other=generateKeyPairSync('rsa',{modulusLength:3072}),envelope=encryptBdlPrivateBundle(bundle(),pem);
  for(const key of [other.privateKey,pair.publicKey,'PRIVATE_TEXT_NOT_A_KEY'])
    assert.throws(()=>decryptBdlPrivateEnvelope(envelope,key),/^Error: PRIVATE_ENVELOPE_DECRYPTION_FAILED$/);
});
test('Weak RSA, EC, private PEM, multiple keys, malformed data and oversized key files reject',()=>{
  const weak=generateKeyPairSync('rsa',{modulusLength:2048}),ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  for(const key of [weak.publicKey.export({format:'pem',type:'spki'}),ec.publicKey.export({format:'pem',type:'spki'})])
    assert.throws(()=>validateBdlRecipientPublicKey(key),/RECIPIENT_RSA_3072_TO_8192_REQUIRED/);
  for(const key of [pair.privateKey.export({format:'pem',type:'pkcs8'}),pem+pem,'bad',Buffer.from(pem),'x'.repeat(16385)])
    assert.throws(()=>validateBdlRecipientPublicKey(key),/INVALID_RECIPIENT_PUBLIC_KEY/);
});
test('Plain bounded JSON only; callbacks, getters and unsupported values never execute',()=>{
  let executed=false;
  const accessor={get secret(){executed=true;return 'PRIVATE';}},method={toJSON(){executed=true;return 'PRIVATE';}};
  for(const value of [accessor,method,undefined,NaN,{bad:undefined},new Date(),{big:'x'.repeat(16000001)}])
    assert.throws(()=>encryptBdlPrivateBundle(value,pem));
  assert.equal(executed,false);
  const envelope=encryptBdlPrivateBundle(bundle(),pem);Object.defineProperty(envelope,'ivBase64',{get(){executed=true;return '';}});
  assert.throws(()=>decryptBdlPrivateEnvelope(envelope,pair.privateKey),/PRIVATE_ENVELOPE_DECRYPTION_FAILED/);assert.equal(executed,false);
});
test('Large valid envelope exceeds receipt-digest size after base64 yet still decrypts within plaintext bound',()=>{
  const input={synthetic:true,payload:'x'.repeat(12500000)},envelope=encryptBdlPrivateBundle(input,pem);
  assert.ok(envelope.ciphertextBase64.length>16000000);assert.deepEqual(decryptBdlPrivateEnvelope(envelope,pair.privateKey),input);
});
