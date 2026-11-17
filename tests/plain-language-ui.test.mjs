import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../public/'+p,import.meta.url),'utf8');
test('game outlook precedes collapsed optional research with working navigation',()=>{
 const html=read('index.html');
 assert.ok(html.indexOf('id="automatic-game-card"')<html.indexOf('id="research-tools"'));
 assert.match(html,/<details id="research-tools" class="research-disclosure">/);
 assert.match(html,/href="\/game-card">Choose an upcoming game/);
 assert.match(read('app.js'),/if\(researchTools\)researchTools.open=tab!=='games'/);
 assert.match(read('app.js'),/scrollIntoView/);
 assert.match(html,/Games &amp; results|Games & results/);
});
test('technical detail is optional while preview and unadjusted warnings remain prominent',()=>{
 const card=read('automatic-card.js'), full=read('game-card.js');
 assert.match(card,/p\('Baseline built '[^\n]+detail\)/);
 assert.match(card,/p\('Current bookmaker odds: UNAVAILABLE[^\n]+\);/);
 assert.match(full,/paragraph\(out,'No current odds[^\n]+'warning'\)/);
 assert.match(full,/paragraph\(out,'SCHEDULED MODEL PREVIEW/);
 assert.match(full,/paragraph\(out,'Models favor opposite teams/);
 assert.match(read('game-card.html'),/aria-label="Choose an upcoming game"/);
});
