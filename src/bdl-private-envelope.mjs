/** In-memory encryption only. Ciphertext is not source authentication or scoring proof. */
import {createPublicKey,createPrivateKey,createCipheriv,createDecipheriv,publicEncrypt,privateDecrypt,
  randomBytes,createHash,constants,KeyObject} from 'node:crypto';
import {bdlReceiptDigest} from './bdl-receipt-ledger.mjs';

export const BDL_PRIVATE_ENVELOPE_POLICY='BDL_PRIVATE_SAMPLE_ENVELOPE_V1';
export const BDL_PRIVATE_BUNDLE_MAX_BYTES=16000000;
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const header=recipientKeySha256=>({schema:1,policy:BDL_PRIVATE_ENVELOPE_POLICY,contentEncryption:'AES-256-GCM',
  keyWrapping:'RSA-OAEP-SHA256',recipientKeySha256,meaning:'PRIVATE_NONQUALIFYING_SAMPLE'});
function publicDetails(key){
  const bits=key.asymmetricKeyDetails?.modulusLength;
  if(key.type!=='public'||key.asymmetricKeyType!=='rsa'||!Number.isInteger(bits)||bits<3072||bits>8192)
    fail('RECIPIENT_RSA_3072_TO_8192_REQUIRED');
  return {publicKey:key,recipientKeySha256:sha(key.export({format:'der',type:'spki'})),modulusLength:bits};
}
/** Accept exactly one PEM SPKI public key, never a certificate or private-key file. */
export function validateBdlRecipientPublicKey(pem){
  if(typeof pem!=='string'||Buffer.byteLength(pem)>16384||
    !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----(?:\r?\n)?$/.test(pem))fail('INVALID_RECIPIENT_PUBLIC_KEY');
  try{return publicDetails(createPublicKey({key:pem,format:'pem',type:'spki'}));}
  catch(error){if(error?.code==='RECIPIENT_RSA_3072_TO_8192_REQUIRED')throw error;fail('INVALID_RECIPIENT_PUBLIC_KEY');}
}
const aad=envelope=>Buffer.from(JSON.stringify({...header(envelope.recipientKeySha256),
  ivBase64:envelope.ivBase64,wrappedKeyBase64:envelope.wrappedKeyBase64}));
/** Random AES key and nonce on every call; mutable key/plaintext buffers are cleared. */
export function encryptBdlPrivateBundle(bundle,recipientPublicKeyPem){
  const recipient=validateBdlRecipientPublicKey(recipientPublicKeyPem);let plaintext,key;
  try{
    // Validate inert bounded JSON before serialization, including toJSON/accessor rejection.
    bdlReceiptDigest(bundle);plaintext=Buffer.from(JSON.stringify(bundle));
    if(!plaintext.length||plaintext.length>BDL_PRIVATE_BUNDLE_MAX_BYTES)fail('PRIVATE_BUNDLE_SIZE_LIMIT');
    key=randomBytes(32);const iv=randomBytes(12);
    const wrapped=publicEncrypt({key:recipient.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
    const envelope={...header(recipient.recipientKeySha256),ivBase64:iv.toString('base64'),wrappedKeyBase64:wrapped.toString('base64')};
    const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});cipher.setAAD(aad(envelope));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    return {...envelope,ciphertextBase64:ciphertext.toString('base64'),authTagBase64:cipher.getAuthTag().toString('base64')};
  }catch(error){
    if(['PRIVATE_BUNDLE_SIZE_LIMIT','RECORD_SIZE_LIMIT','RECORD_COMPLEXITY_LIMIT','PLAIN_RECORD_REQUIRED',
      'INVALID_RECORD_ARRAY'].includes(error?.code))throw error;
    fail('PRIVATE_BUNDLE_ENCRYPTION_FAILED');
  }finally{key?.fill(0);plaintext?.fill(0);}
}
function decoded(value,max,exact=null){
  if(typeof value!=='string'||!value.length||value.length>4*Math.ceil(max/3))fail('INVALID_PRIVATE_ENVELOPE');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>max||(exact!==null&&bytes.length!==exact)||bytes.toString('base64')!==value)fail('INVALID_PRIVATE_ENVELOPE');return bytes;
}
/** Local owner-side helper. The CLI deliberately has no decrypt-to-file mode. */
export function decryptBdlPrivateEnvelope(envelope,recipientPrivateKey){
  let key,plaintext,unauthenticated,tail;
  try{
    if(!envelope||Object.getPrototypeOf(envelope)!==Object.prototype||Reflect.ownKeys(envelope).some(name=>
      typeof name!=='string'||!Object.getOwnPropertyDescriptor(envelope,name)?.enumerable||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(envelope,name),'value')))fail('INVALID_PRIVATE_ENVELOPE');
    const keys=[...Object.keys(header('')), 'ivBase64','wrappedKeyBase64','ciphertextBase64','authTagBase64'].sort();
    if(!envelope||Object.getPrototypeOf(envelope)!==Object.prototype||Object.keys(envelope).length!==keys.length||
      Object.keys(envelope).sort().some((k,i)=>k!==keys[i])||typeof envelope.recipientKeySha256!=='string'||
      !/^[a-f0-9]{64}$/.test(envelope.recipientKeySha256))fail('INVALID_PRIVATE_ENVELOPE');
    for(const [name,value] of Object.entries(header(envelope.recipientKeySha256)))if(envelope[name]!==value)fail('INVALID_PRIVATE_ENVELOPE');
    const privateKey=recipientPrivateKey instanceof KeyObject?recipientPrivateKey:createPrivateKey(recipientPrivateKey);
    if(privateKey.type!=='private')fail('INVALID_PRIVATE_ENVELOPE');
    const recipient=publicDetails(createPublicKey(privateKey));
    if(recipient.recipientKeySha256!==envelope.recipientKeySha256)fail('INVALID_PRIVATE_ENVELOPE');
    const iv=decoded(envelope.ivBase64,12,12),tag=decoded(envelope.authTagBase64,16,16),
      wrapped=decoded(envelope.wrappedKeyBase64,1024,Math.ceil(recipient.modulusLength/8)),
      ciphertext=decoded(envelope.ciphertextBase64,BDL_PRIVATE_BUNDLE_MAX_BYTES);
    key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},wrapped);
    if(key.length!==32)fail('INVALID_PRIVATE_ENVELOPE');
    const decipher=createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16});decipher.setAAD(aad(envelope));decipher.setAuthTag(tag);
    unauthenticated=decipher.update(ciphertext);tail=decipher.final();plaintext=Buffer.concat([unauthenticated,tail]);
    const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));bdlReceiptDigest(bundle);return bundle;
  }catch{fail('PRIVATE_ENVELOPE_DECRYPTION_FAILED');}
  finally{key?.fill(0);plaintext?.fill(0);unauthenticated?.fill(0);tail?.fill(0);}
}
