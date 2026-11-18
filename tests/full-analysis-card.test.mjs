import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/game-card.js',import.meta.url),'utf8');
const segment=js.slice(js.indexOf('function renderAnalysisCard('),js.indexOf("$('request').addEventListener('submit'"));
class Element{constructor(tag){this.tag=tag;this.children=[];this.textContent='';}append(...nodes){this.children.push(...nodes);}}
const ctx=vm.createContext({document:{createElement:tag=>new Element(tag)},Date,percent:x=>(x*100).toFixed(1)+'%'});vm.runInContext(segment,ctx);
const r={preview:true,fixture:{home:'Texans',away:'Colts',kickoff:'2026-11-20T01:15:00Z'},baseline:{homeWinProbability:.666,awayWinProbability:.334}};
const flat=n=>[n.textContent,...n.children.flatMap(flat)].join(' ');
function render(input=r){const root=new Element('div');ctx.renderAnalysisCard(root,input);return root;}
test('full card separates actual winner estimates from unsupported spread, total and score models',()=>{const text=flat(render());for(const expected of ['66.6%','33.4%','Sportsbook snapshot','Spread analysis','Total analysis','Not evaluated','Projected score','Not supported','not automatically saved or graded'])assert.ok(text.includes(expected),expected);assert.doesNotMatch(text,/65%|70%|24\.1%|25–23|Recommended|0\.50u/);assert.match(text,/Win chance is not the chance of covering/);assert.doesNotMatch(segment,/fetch\(|innerHTML|localStorage|Math\.random/);});
test('underdog/away leader and ties are displayed without favorite bias or invented win probabilities',()=>{assert.match(flat(render({...r,baseline:{homeWinProbability:.3,awayWinProbability:.7}})),/Colts Preliminary outright lean · 70.0%/);const tied=flat(render({...r,baseline:{homeWinProbability:.5,awayWinProbability:.5}}));assert.match(tied,/No outright preference/);assert.match(tied,/evenly split/);});
test('labels use text nodes and the results deep link selects the actual results page',()=>{const root=render({...r,fixture:{...r.fixture,away:'<script>oops</script>'}});assert.ok(flat(root).includes('<script>oops</script>'));const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(app,/tab: location.hash === '#game-grades' \? 'games' : 'overview'/);assert.match(segment,/link.href='\/#game-grades'/);});
