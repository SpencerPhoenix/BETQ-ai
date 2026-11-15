import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProviderBudget, isProviderBudgetAccountId} from '../src/provider-budget.mjs';
import {configuredProviderBudget} from '../src/configured-provider-budget.mjs';

const valid=['a','0','odds:main','A_0.-:z','a'.repeat(100),'a'.repeat(128)];
const invalid=[undefined,null,1,'','_main','.main','-main',':main','a'.repeat(129),' a','a ','a/b','é','a\n','a\r','a\r\n','a\u2028','a\u2029','a\0'];

test('Account IDs use the full shared SQL contract including colon and 128 characters',async()=>{
  const sql=await readFile(new URL('../sql/provider-budget.sql',import.meta.url),'utf8');
  const pattern=new RegExp(sql.match(/account_id ~ '([^']+)'/)[1]);
  for(const value of valid){assert.equal(isProviderBudgetAccountId(value),true);assert.equal(pattern.exec(value)?.[0],value);}
  for(const value of invalid)assert.equal(isProviderBudgetAccountId(value),false,String(value));
});

test('Configured adapter and ledger reject the same invalid account IDs before driver or connection',async()=>{
  let factories=0,connects=0;
  for(const accountId of invalid){
    const pool={connect:async()=>{connects++;throw Error('must not connect');}};
    const ledger=createProviderBudget({accountId,pool,baselineMaxAgeSeconds:3600});
    await assert.rejects(ledger.status(),{code:'BUDGET_CONFIG_INVALID'});
    const configured=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:accountId,
      BETQ_BUDGET_DATABASE_URL:'postgresql://offline.invalid/fixture'},
      clientFactory:async()=>{factories++;return pool;}});
    await assert.rejects(configured.reserve({estimatedCredits:1}),{code:'DURABLE_BUDGET_REQUIRED'});
  }
  assert.equal(factories,0);assert.equal(connects,0);
});

test('Configured adapter and ledger accept the same valid account IDs',async()=>{
  for(const accountId of valid){
    let factories=0,connects=0;
    const pool={query:async()=>{},connect:async()=>{connects++;throw Error('offline');}};
    await assert.rejects(createProviderBudget({accountId,pool,baselineMaxAgeSeconds:3600}).status(),{code:'BUDGET_STORAGE_UNAVAILABLE'});
    const configured=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:accountId,
      BETQ_BUDGET_DATABASE_URL:'postgresql://offline.invalid/fixture'},clientFactory:async()=>{factories++;return pool;}});
    assert.equal((await configured.status()).reason,'BUDGET_STORAGE_UNAVAILABLE');
    assert.equal(factories,1);assert.equal(connects,2);
  }
});
