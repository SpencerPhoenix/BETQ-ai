import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const segment=(start,end)=>js.slice(js.indexOf(start),js.indexOf(end,js.indexOf(start)));
const format=segment('  const when =','  const relativeAge =');
const baseNow=Date.parse('2026-11-07T23:59:00Z');
function harness(){let now=baseNow;class Clock extends Date{static now(){return now;}}
 const labels=[{textContent:'',getAttribute:()=> 'college-one'}];
 const state={mode:'live',slate:{events:[{id:'college-one',commenceTime:'2026-11-08T00:00:00Z',started:false}]}};
 const context={Date:Clock,Intl,state,document:{querySelectorAll:()=>labels}};
 vm.runInNewContext(format+'globalThis.api={when,schedulePhase,refreshScheduleLabels};',context);
 return {...context,labels,advance:ms=>{now+=ms;},api:context.api};}
test('Displayed time includes a zone and converts the UTC day to the viewer zone',()=>{
 const {api}=harness();
 assert.match(api.when('2026-11-08T21:25:00Z',{timeZone:'America/Los_Angeles'}),/1:25.*PST/);
 assert.match(api.when('2026-11-08T00:00:00Z',{timeZone:'America/New_York'}),/Nov 7.*7:00.*(EST|GMT-5)/);
 assert.match(api.when('2026-11-08T21:25:00Z',{timeZone:'UTC'}),/21:25|9:25/);
});
test('Cached college kickoff labels advance without inventing in-play status or replacing DOM nodes',()=>{
 const h=harness(),label=h.labels[0];h.api.refreshScheduleLabels();assert.equal(label.textContent,'SCHEDULED UPCOMING');
 h.advance(60000);h.api.refreshScheduleLabels();assert.match(label.textContent,/SCHEDULED START PASSED.*STATUS UNVERIFIED/);
 assert.equal(h.labels[0],label);assert.equal(h.state.slate.events[0].started,false);
 assert.equal(h.api.schedulePhase({commenceTime:null}),'SCHEDULE UNKNOWN');
});
test('Periodic schedule label refresh and frozen-vs-published wording stay explicit',()=>{
 assert.match(js,/refreshScheduleLabels\(\);/);assert.doesNotMatch(js,/IN PROGRESS \/ STARTED/);
 for(const label of ['Kickoff recorded with forecast (UTC)','Published scheduled kickoff (UTC)','dated observation, not a live schedule check','timeZoneName: \'short\''])assert.ok(js.includes(label),label);
});

test('Schedule conflict and identity-mismatch notices remain distinct and never claim live verification',()=>{
 const context={Date,esc:value=>String(value),dossierTime:value=>value};
 vm.runInNewContext(segment('  function scheduleReviewHTML','  function frozenSnapshotHTML')+'globalThis.render=scheduleReviewHTML;',context);
 const mismatch=context.render({status:'SCHEDULE_REVIEW_IDENTITY_MISMATCH'});
 assert.match(mismatch,/Schedule identity mismatch: review required/);assert.match(mismatch,/No corrected kickoff is applied/);
 assert.match(js,/\['SCHEDULE_RECONCILIATION_REQUIRED','SCHEDULE_REVIEW_IDENTITY_MISMATCH'\]\.includes\(event.scheduleReview\?\.status\)/);
 const known={status:'SCHEDULE_RECONCILIATION_REQUIRED',currentScheduleVerified:false,scoringAuthorization:false,publicationTimeVerified:false,publishedCommenceTime:'2026-11-08T21:25:00.000Z',observedAt:'2026-11-07T19:43:37.000Z',sources:[{url:'https://www.49ers.com/news/ways-to-watch-and-listen-raiders-vs-49ers-week-9'}]};
 assert.match(context.render(known),/Schedule conflict: reconciliation required/);
 for(const patch of [{currentScheduleVerified:true},{scoringAuthorization:true},{publicationTimeVerified:true},{observedAt:'2099-01-01T00:00:00Z'},{sources:[{url:'https://evil.example'}]}])assert.match(context.render({...known,...patch}),/Current official schedule has not been verified/);
});
