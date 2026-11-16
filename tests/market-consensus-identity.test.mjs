import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKET_BOOK_IDENTITY_POLICY,nflMoneylineConsensus} from '../src/market-consensus.mjs';

// Fabricated source objects only. No transport, credentials or evidence-file writes.
const NOW=Date.parse('2026-11-16T12:00:00.000Z');
const iso=value=>new Date(value).toISOString();
const home='Synthetic Home',away='Synthetic Away';
const market=(price=110,age=1000)=>({key:'h2h',last_update:iso(NOW-age),
  outcomes:[{name:home,price:-price},{name:away,price}]});
const book=(key,price=110,age=1000)=>({key,last_update:iso(NOW),markets:[market(price,age)]});
const others=()=>[book('unaffected-a',105,4000),book('unaffected-b',110,3000),book('unaffected-c',115,2000)];
const event=bookmakers=>({id:'synthetic-event',home_team:home,away_team:away,
  commence_time:iso(NOW+3600000),bookmakers});
const run=(books,options={})=>nflMoneylineConsensus(event(books),{asOf:NOW,receivedAt:iso(NOW),...options});
function* permutations(items){
  if(items.length<2){yield items;return;}
  for(let i=0;i<items.length;i++)for(const rest of permutations(items.filter((_,j)=>i!==j)))
    yield [items[i],...rest];
}
const integrity=result=>result.bookmakerIntegrity;
const withoutIntegrity=result=>Object.fromEntries(Object.entries(result).filter(([key])=>key!=='bookmakerIntegrity'));

test('valid unique identities preserve consensus and expose only fixed count diagnostics',()=>{
  const books=others(),before=structuredClone(books),out=run(books);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(out.basis,'MARKET_DERIVED_NOT_INDEPENDENT');
  assert.equal(integrity(out).policy,MARKET_BOOK_IDENTITY_POLICY);
  assert.deepEqual(integrity(out),{policy:MARKET_BOOK_IDENTITY_POLICY,bookmakerRecords:3,
    invalidBookmakerCollection:0,invalidBookmakerKeys:0,duplicateBookmakerKeys:0,duplicateBookmakerRecords:0,
    invalidMarketCollections:0,duplicateTargetMarketBooks:0,missingTargetMarketBooks:0,
    eligibleBookmakerRecords:3,excludedBookmakerRecords:0});
  for(const [key,value] of Object.entries(integrity(out)))if(key!=='policy')assert.ok(Number.isSafeInteger(value)&&value>=0);
  assert.deepEqual(books,before);
  assert.equal(JSON.stringify(out).includes('unaffected-a'),false);
  assert.equal(Object.hasOwn(out,'sourceIndependenceVerified'),false);
  assert.equal(Object.hasOwn(out,'bookmakers'),false);
});

test('duplicate bookmaker keys are excluded in every order rather than selecting a quote',()=>{
  const books=[book('ambiguous',100,500000),book('ambiguous',125,1000),...others().slice(0,2)],before=structuredClone(books);
  const expected=run(books);
  assert.equal(expected.available,false);assert.equal(expected.reason,'INSUFFICIENT_INDEPENDENT_BOOKS');
  assert.equal(expected.books,2);assert.equal(integrity(expected).duplicateBookmakerKeys,1);
  assert.equal(integrity(expected).duplicateBookmakerRecords,2);
  for(const order of permutations(books))assert.deepEqual(run(order),expected);
  assert.deepEqual(books,before);
});

test('three unaffected books survive duplicates and determine all derived quote bounds',()=>{
  const clean=run(others()),books=[book('ambiguous',100,500000),book('ambiguous',125,1000),...others()];
  const expected=run(books);
  assert.equal(expected.available,true);assert.equal(expected.books,3);
  assert.deepEqual(withoutIntegrity(expected),withoutIntegrity(clean));
  assert.equal(integrity(expected).excludedBookmakerRecords,2);
  for(const order of permutations(books))assert.deepEqual(run(order),expected);
});

for(const [label,duplicate] of Object.entries({
  missingMarkets:{key:'ambiguous'},nullMarkets:{key:'ambiguous',markets:null},
  objectMarkets:{key:'ambiguous',markets:{h2h:market()}},emptyMarkets:{key:'ambiguous',markets:[]},
  invalidMarketEntry:{key:'ambiguous',markets:[null]},
  stale:book('ambiguous',110,600001),future:book('ambiguous',110,-1),
  missingTimestamp:{key:'ambiguous',markets:[{key:'h2h',outcomes:market().outcomes}]},
  malformedTimestamp:{key:'ambiguous',markets:[{...market(),last_update:'not-a-time'}]},
  invalidPrice:{key:'ambiguous',markets:[{...market(),outcomes:[{name:home,price:0},{name:away,price:110}]}]},
  invalidOutcomes:{key:'ambiguous',markets:[{...market(),outcomes:null}]}
}))test('duplicate key poisons both records before '+label+' filtering',()=>{
  const books=[book('ambiguous'),duplicate,...others().slice(0,2)],out=run(books);
  assert.equal(out.available,false);assert.equal(out.books,2);
  assert.equal(integrity(out).duplicateBookmakerKeys,1);
  assert.equal(integrity(out).duplicateBookmakerRecords,2);
  assert.deepEqual(run([...books].reverse()),out);
});

test('three or more copies count one ambiguous key and exclude every copy',()=>{
  const out=run([book('ambiguous'),book('ambiguous'),{key:'ambiguous'},...others()]);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).duplicateBookmakerKeys,1);
  assert.equal(integrity(out).duplicateBookmakerRecords,3);
});

for(const [label,extra] of Object.entries({
  conflicting:market(125,500000),identical:market(),missingOutcomes:{key:'h2h'},
  nullOutcomes:{key:'h2h',outcomes:null},stale:market(110,600001),future:market(110,-1),
  missingTimestamp:{key:'h2h',outcomes:market().outcomes}
}))test('duplicate h2h entries reject the bookmaker even when '+label,()=>{
  const first=market(100),books=[{key:'ambiguous-market',markets:[first,extra]},...others().slice(0,2)];
  const out=run(books);
  assert.equal(out.available,false);assert.equal(out.books,2);
  assert.equal(integrity(out).duplicateTargetMarketBooks,1);
  assert.deepEqual(run([{key:'ambiguous-market',markets:[extra,first]},...others().slice(0,2)]),out);
  const validOthers=run([{key:'ambiguous-market',markets:[first,extra]},...others()]);
  assert.equal(validOthers.available,true);assert.equal(validOthers.books,3);
  assert.deepEqual(withoutIntegrity(validOthers),withoutIntegrity(run(others())));
});

for(const [label,key] of Object.entries({empty:'',spaces:' ',leading:' book',trailing:'book ',
  newline:'book\n',embeddedControl:'book\u0000name',deleteControl:'book\u007fname',
  c1Control:'book\u0085name',lastC1Control:'book\u009fname',oversize:'x'.repeat(201),
  number:42,null:null,object:{},array:[]
}))test('rejects invalid bookmaker key '+label+' without repairing it',()=>{
  const out=run([book(key),...others()]);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).invalidBookmakerKeys,1);
  assert.equal(integrity(out).excludedBookmakerRecords,1);
  assert.deepEqual(withoutIntegrity(out),withoutIntegrity(run(others())));
});

test('spacing variants cannot inflate one bookmaker into three contributors',()=>{
  const out=run([book('same'),book(' same'),book('same ')]);
  assert.equal(out.available,false);assert.equal(out.books,1);
  assert.equal(integrity(out).invalidBookmakerKeys,2);
});

test('exact key length bound is accepted and not normalized',()=>{
  const out=run([book('x'.repeat(200)),...others().slice(0,2)]);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).invalidBookmakerKeys,0);
});

for(const [label,input] of Object.entries({null:null,object:{},string:'invalid',missing:undefined,
  sparse:[...others(),,],oversize:Array.from({length:1001},(_,i)=>book('synthetic-'+i))
}))test('fails closed for unenumerable or unbounded bookmaker collection '+label,()=>{
  const out=run(input);
  assert.equal(out.available,false);assert.equal(out.reason,'INVALID_BOOKMAKER_COLLECTION');
  assert.equal(integrity(out).invalidBookmakerCollection,1);
  assert.equal(integrity(out).eligibleBookmakerRecords,0);
});

test('does not invoke bookmaker-array accessors or attempt partial collection recovery',()=>{
  const books=others();let reads=0;
  Object.defineProperty(books,'3',{get(){reads++;return book('hidden');},enumerable:true});
  const out=run(books);
  assert.equal(out.available,false);assert.equal(out.reason,'INVALID_BOOKMAKER_COLLECTION');
  assert.equal(reads,0);
});

test('bookmaker key accessors are invalid and cannot participate in the identity count',()=>{
  let reads=0;const invalid={markets:[market()]};
  Object.defineProperty(invalid,'key',{get(){reads++;return 'hidden';},enumerable:true});
  const out=run([invalid,...others()]);
  assert.equal(out.available,true);assert.equal(integrity(out).invalidBookmakerKeys,1);assert.equal(reads,0);
});

test('known duplicate identity with an accessor-backed market is rejected before access',()=>{
  let reads=0;const invalid={key:'ambiguous'};
  Object.defineProperty(invalid,'markets',{get(){reads++;return [market()];},enumerable:true});
  const out=run([book('ambiguous'),invalid,...others()]);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).duplicateBookmakerRecords,2);assert.equal(reads,0);
});

for(const [label,markets] of Object.entries({null:null,object:{},missing:undefined,
  sparse:[market(),,],nullEntry:[market(),null],missingKey:[market(),{}],
  emptyKey:[market(),{key:''}],paddedTarget:[market(),{key:' h2h'}],
  oversize:[market(),...Array.from({length:100},(_,i)=>({key:'synthetic-market-'+i}))]
}))test('rejects bookmaker with unenumerable market identities '+label,()=>{
  const out=run([{key:'malformed-collection',markets},...others()]);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).invalidMarketCollections,1);
  assert.deepEqual(withoutIntegrity(out),withoutIntegrity(run(others())));
});

test('market arrays and key accessors are not interpreted as hidden target entries',()=>{
  let reads=0;const first=[market()];
  Object.defineProperty(first,'1',{get(){reads++;return market();},enumerable:true});
  const hidden={};Object.defineProperty(hidden,'key',{get(){reads++;return 'h2h';},enumerable:true});
  for(const markets of [first,[market(),hidden]]){
    const out=run([{key:'malformed',markets},...others()]);
    assert.equal(out.available,true);assert.equal(out.books,3);
    assert.equal(integrity(out).invalidMarketCollections,1);
  }
  assert.equal(reads,0);
});

test('bounded unrelated markets do not disqualify exactly one target market',()=>{
  const books=[{key:'many-markets',markets:[market(),...Array.from({length:99},(_,i)=>({key:'synthetic-market-'+i}))]},...others().slice(0,2)];
  const out=run(books);assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).invalidMarketCollections,0);
});

test('missing target market is diagnostic rather than a fabricated contributor',()=>{
  const out=run([{key:'empty',markets:[]},{key:'other',markets:[{key:'spreads'}]},...others()]);
  assert.equal(out.available,true);assert.equal(out.books,3);
  assert.equal(integrity(out).missingTargetMarketBooks,2);
  assert.equal(integrity(out).excludedBookmakerRecords,2);
});

for(const [label,age,available] of [['exact boundary',600000,true],['one millisecond stale',600001,false],['future source quote',-1,false]])
  test('unique identities preserve '+label+' timestamp rejection',()=>{
    const out=run([book('boundary',110,age),...others().slice(0,2)]);
    assert.equal(out.available,available);assert.equal(out.books,available?3:2);
    assert.equal(integrity(out).eligibleBookmakerRecords,3,'Identity readiness does not certify quote freshness');
    if(available)assert.equal(out.oldestQuoteAt,iso(NOW-600000));
  });

test('quotes must precede original receipt and expiry is reevaluated after delivery',()=>{
  assert.equal(run([book('receipt-order',110,500),...others().slice(0,2)],{receivedAt:iso(NOW-1000)}).available,false);
  const books=[book('boundary',110,599000),...others().slice(0,2)];
  assert.equal(run(books,{asOf:NOW+1000}).available,true);
  assert.equal(run(books,{asOf:NOW+1001,maxAgeMs:9999999}).available,false);
});

test('bookmaker-level freshness cannot replace absent market timestamp proof',()=>{
  const bad=book('no-market-timestamp');delete bad.markets[0].last_update;
  const out=run([bad,...others().slice(0,2)]);
  assert.equal(out.available,false);assert.equal(out.books,2);
  assert.equal(integrity(out).eligibleBookmakerRecords,3);
});

test('valid explicit-offset market instants survive identity filtering without rounding',()=>{
  const offset=book('offset');offset.markets[0].last_update='2026-11-16T06:59:59.123-05:00';
  const out=run([offset,...others().slice(0,2)]);
  assert.equal(out.available,true);assert.equal(out.latestQuoteAt,'2026-11-16T11:59:59.123Z');
});

test('existing minimum contributor bound cannot be lowered by a caller',()=>{
  assert.equal(run(others(),{minBooks:2}).reason,'INVALID_CONSENSUS_CONFIGURATION');
  assert.equal(run(others(),{minBooks:4}).available,false);
});
