"""Offline retained forecast QA. All browser requests are intercepted; no external reads.
Run: python tests/retained-forecasts-browser.py [artifact-directory]
Requires existing Python Playwright and Chromium.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/betq-retained-forecasts-browser')
OUT.mkdir(parents=True,exist_ok=True)
fixtures=json.loads(subprocess.check_output(['node','--input-type=module','-e',"""
import fs from 'node:fs';
import {listRetainedForecasts,listGameDossiers,buildGameDossier} from './src/game-dossier.mjs';
import {recomputeJournalEvidence} from './src/evidence-journal-feed.mjs';
const journal=JSON.parse(fs.readFileSync('tests/fixtures/retained-20261114/nfl-2026.json'));
const now=Math.max(...journal.snapshots.map(s=>Date.parse(s.capturedAt)),
  ...journal.settlements.map(s=>Date.parse(s.verifiedAt)))+60000,index=listGameDossiers(journal,{now});
console.log(JSON.stringify({now,forecasts:listRetainedForecasts(journal,{now}),index,summary:recomputeJournalEvidence(journal,now),
  dossiers:Object.fromEntries(index.games.map(g=>[g.gameId,buildGameDossier(journal,{now,gameId:g.gameId})]))}));
"""],cwd=ROOT,text=True))
requests=[]
errors=[]
unexpected=[]
failed=False
def route_all(route):
    req=route.request
    url=urlparse(req.url)
    requests.append({'path':url.path,'method':req.method,'paid':req.headers.get('x-betq-paid-request'),'auth':req.headers.get('authorization')})
    if url.hostname!='betq.test':
        unexpected.append(req.url);route.abort();return
    if url.path=='/' or url.path in ['/app.js','/game-grades.js','/game-strategies.js','/retained-forecasts.js','/styles.css','/favicon.svg']:
        f=ROOT/'public'/('index.html' if url.path=='/' else url.path[1:])
        route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[f.suffix],body=f.read_bytes());return
    if url.path=='/api/research/forecasts' and not failed:
        route.fulfill(status=200,json=fixtures['forecasts']);return
    if url.path=='/api/research/games':
        route.fulfill(status=200,json=fixtures['index']);return
    if url.path=='/api/evidence/nfl':
        route.fulfill(status=200,json=fixtures['summary']);return
    if url.path=='/api/research/game':
        game=parse_qs(url.query).get('gameId',[''])[0]
        if game in fixtures['dossiers']:
            route.fulfill(status=200,json=fixtures['dossiers'][game]);return
    route.fulfill(status=503,json={'error':{'code':'OFFLINE_FIXTURE','message':'No external request is permitted.'}})

def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce',service_workers='block')
    context.route('**/*',route_all)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    # Python Playwright numeric clock times are seconds; journal values are JS milliseconds.
    page.clock.install(time=fixtures['now']/1000)
    page.goto('http://betq.test/')
    page.locator('.nav-item[data-tab="games"]').click()
    root=page.locator('#retained-forecasts')
    expect(root.locator('.retained-forecast-card')).to_have_count(len(fixtures['forecasts']['games']))
    kc=root.locator('[data-retained-forecast="2026_09_NYJ_KC"]')
    sf=root.locator('[data-quarantined-game="2026_09_LV_SF"]')
    expect(kc).to_contain_text('KC 79.4%')
    expect(kc.locator('[data-forecast-rank]')).to_contain_text('Not ranked')
    expect(sf).to_contain_text('LV @ SF')
    expect(sf).to_contain_text('2026-11-08T21:05:00.000Z')
    expect(sf).to_contain_text('2026-11-08T21:25:00.000Z')
    expect(sf).to_contain_text('Not eligible for ranking, scoring or collection')
    expect(root).to_contain_text('Quarantined games: 1 of 44')
    expect(root).to_contain_text('Excluded snapshots: 9 of 323')
    expect(root).to_contain_text('Excluded result records: 1 of 18')
    assert sf.locator('button,meter').count()==0
    assert root.locator('[data-retained-forecast="2026_09_LV_SF"]').count()==0
    assert page.locator('#retained-games-list [data-dossier-game="2026_09_LV_SF"]').count()==0
    expect(root).to_contain_text('Spread-cover and total probabilities unavailable')
    assert root.locator('[data-paper],input,form').count()==0
    before=root.inner_text()
    page.locator('.mode-toggle [data-mode="demo"]').click()
    expect(root).to_have_text(before,use_inner_text=True)
    page.locator('[data-sport="basketball_nba"]').click()
    expect(root).to_have_text(before,use_inner_text=True)
    no_overflow(page)
    root.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'desktop-retained-forecasts.png'))
    page.locator('.nav-item[data-tab="evidence"]').click()
    expect(page.locator('#evidence-view .schedule-quarantine')).to_contain_text('LV @ SF')
    expect(page.locator('#evidence-view .schedule-quarantine')).to_contain_text('2026-11-08T21:25:00.000Z')
    page.locator('.nav-item[data-tab="games"]').click()
    opener=kc.locator('button[data-dossier-game]')
    for _ in range(2):
        opener.focus();page.keyboard.press('Enter')
        expect(page.locator('#game-dossier')).to_be_visible()
        expect(page.locator('#game-dossier-content')).to_contain_text('KC')
        page.locator('[data-action="close-dossier"]').click()
        expect(page.locator('#game-dossier')).to_be_hidden();expect(opener).to_be_focused()
    opener.focus();page.keyboard.press('Enter')
    page.locator('.nav-item[data-tab="evidence"]').click()
    expect(page.locator('#game-dossier')).to_be_hidden()
    page.locator('.nav-item[data-tab="games"]').click()
    expect(page.locator('#game-dossier')).to_be_hidden()
    expect(page.locator('#game-dossier-content')).to_be_empty()
    count=len(requests);opener.focus()
    page.clock.fast_forward(25*3600000)
    expect(kc.locator('[data-forecast-status]')).to_contain_text('Stale capture')
    expect(kc.locator('[data-forecast-rank]')).to_contain_text('Not ranked')
    expect(opener).to_be_focused();assert len(requests)==count
    page.set_viewport_size({'width':390,'height':844});no_overflow(page)
    sf.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'mobile-quarantine-warning.png'))
    kc.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'mobile-retained-forecast.png'))
    failed=True
    page.evaluate("""async () => BETQRetainedForecasts.load(document.querySelector('#retained-forecasts'), async path => {
      const response = await fetch(path); if (!response.ok) throw Error('offline'); return response.json();
    })""")
    expect(root).to_contain_text('Saved forecasts unavailable')
    expect(root.locator('.retained-forecast-card')).to_have_count(0)
    page.clock.fast_forward(15000);expect(root).to_contain_text('Saved forecasts unavailable')
    assert not errors,errors
    assert not unexpected,unexpected
    assert all(r['method']=='GET' and not r['paid'] and not r['auth'] for r in requests),requests
    result={'passed':True,'requestsIntercepted':len(requests),'externalRequests':unexpected,'browserErrors':errors,
      'checks':['actual latest bundled Elo','conflicted probabilities withheld','quarantine counts and original kickoffs disclosed','summary quarantine warning','model/market distinction','demo/non-NFL separation','keyboard repeated dossier open/close','navigation closes dossier without resurrecting content','focus-safe clock aging','stale ranks removed','desktop/mobile overflow','unavailable read clears forecasts','no wagering or paid requests']}
    (OUT/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
    browser.close()
