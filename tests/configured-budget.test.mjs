import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredProviderBudget} from '../src/configured-provider-budget.mjs';

test('Missing configuration blocks without loading driver or credentials',async()=>{
  let calls=0;
  const budget=configuredProviderBudget({env:{},clientFactory:async()=>{calls++;throw Error('do not load');}});
  await assert.rejects(budget.reserve({estimatedCredits:1}),error=>{
    assert.equal(error.code,'DURABLE_BUDGET_REQUIRED');assert.equal(error.status,503);
    assert.equal(typeof error.message,'string');assert.match(error.message,/configured durable/);return true;
  });
  const status=await budget.status();
  assert.equal(status.ready,false);assert.equal(status.available,false);
  assert.equal(calls,0);
});

test('Lazy driver failure is sanitized and reports no provider permission',async()=>{
  const budget=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:'offline-fixture',
    BETQ_BUDGET_DATABASE_URL:'postgresql://offline.invalid/fixture'},
    clientFactory:async()=>{throw Error('mock-secret-do-not-leak');}});
  await assert.rejects(budget.reserve({estimatedCredits:1}),error=>{
    assert.equal(error.status,503);assert.equal(error.code,'DURABLE_BUDGET_UNAVAILABLE');
    assert.doesNotMatch(error.message,/mock-secret/);return true;
  });
  assert.doesNotMatch(JSON.stringify(await budget.status()),/mock-secret|postgresql/);
});

test('Configured budget passes strict cap and floor without silently authorizing invalid settings',async()=>{
  let connects=0;
  const pool={query:async()=>{},connect:async()=>{connects++;throw Error('fixture connection should not happen');}};
  for(const field of ['ODDS_DAILY_CREDIT_LIMIT','ODDS_MIN_CREDITS_RESERVE']){
    const budget=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:'fixture',
      BETQ_BUDGET_DATABASE_URL:'postgresql://offline.invalid/fixture',[field]:''},clientFactory:async()=>pool});
    await assert.rejects(budget.reserve({estimatedCredits:1}),{code:'BUDGET_CONFIG_INVALID'});
  }
  assert.equal(connects,0);
});

test('Missing explicit age policy cannot inherit a different process environment',async()=>{
  const name='BETQ_BUDGET_BASELINE_MAX_AGE_SECONDS',previous=process.env[name];
  process.env[name]='3600';let connects=0;
  try{
    const pool={query:async()=>{},connect:async()=>{connects++;throw Error('must not connect');}};
    const budget=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:'fixture',
      BETQ_BUDGET_DATABASE_URL:'postgresql://offline.invalid/fixture'},clientFactory:async()=>pool});
    await assert.rejects(budget.reserve({estimatedCredits:1}),{code:'BUDGET_BASELINE_POLICY_REQUIRED'});
    assert.equal(connects,0);
  }finally{if(previous===undefined)delete process.env[name];else process.env[name]=previous;}
});
