"""Offline browser strategy QA. Every request is intercepted; no provider or external calls.
Run: python tests/game-strategies-browser.py [artifact-directory]
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
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/betq-strategies-browser')
OUT.mkdir(parents=True,exist_ok=True)
fixtures=json.loads(subprocess.check_output(['node','--input-type=module','-e',"""
import {demoEvents} from './src/demo.mjs';
import {analyzeEvents} from './src/engine.mjs';
const asOf=Date.now(), sport='americanfootball_nfl';
console.log(JSON.stringify(Object.fromEntries(['h2h','spreads','totals'].map(market=>[market,{
...analyzeEvents(demoEvents(sport,asOf),{sport,market,asOf,demo:true}),receivedAt:new Date(asOf).toISOString(),executionGate:{bettingAuthorized:false},fixtureOnly:true}]))));
"""],cwd=ROOT,text=True))
requests=[]
errors=[]
unexpected=[]
def route_all(route):
    req=route.request
    url=urlparse(req.url)
    requests.append({'path':url.path,'method':req.method,'paid':req.headers.get('x-betq-paid-request'),'auth':req.headers.get('authorization')})
    if url.hostname!='betq.test':
        unexpected.append(req.url);route.abort();return
    if url.path=='/' or url.path in ['/app.js','/retained-forecasts.js','/game-grades.js','/game-strategies.js','/styles.css','/favicon.svg']:
        f=ROOT/'public'/('index.html' if url.path=='/' else url.path[1:])
        route.fulfill(status=200,content_type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[f.suffix],body=f.read_bytes());return
    if url.path=='/api/slate':
        market=parse_qs(url.query).get('market',['h2h'])[0]
        route.fulfill(status=200,json=fixtures[market]);return
    route.fulfill(status=503,json={'error':{'code':'OFFLINE_FIXTURE','message':'Not included in offline fixture.'}})
def games(page):
    if page.viewport_size['width']<=850:page.locator('#menu-toggle').click()
    page.locator('.nav-item[data-tab="games"]').click()
def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce',service_workers='block')
    context.route('**/*',route_all)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.clock.install()
    page.goto('http://betq.test/')
    page.locator('#research-tools > summary').focus()
    page.keyboard.press('Enter')
    expect(page.locator('#research-tools')).to_have_attribute('open','')
    page.locator('.mode-toggle [data-mode="demo"]').click()
    expect(page.locator('#game-grid .game-card')).to_have_count(3)
    games(page)
    if page.locator('.result-archive').get_attribute('open') is None:page.locator('.result-archive > summary').click()
    if page.locator('#research-tools').get_attribute('open') is None:page.locator('#research-tools > summary').click()
    details=page.locator('#game-grid .game-strategies').first
    summary=details.locator('summary')
    summary.focus();before=len(requests);page.keyboard.press('Enter')
    expect(details).to_have_attribute('open','')
    expect(details.locator('.strategy-option')).to_have_count(2)
    expect(details).to_contain_text('SYNTHETIC DEMO')
    expect(details).to_contain_text('Suggested stake: 0')
    expect(details).to_contain_text('A tie is not assumed to push')
    assert len(requests)==before
    page.clock.fast_forward(15000)
    expect(summary).to_be_focused();expect(details).to_have_attribute('open','')
    assert len(requests)==before
    no_overflow(page)
    page.screenshot(path=str(OUT/'desktop-moneyline-strategies.png'),full_page=True)
    summary.press('Space');expect(details).not_to_have_attribute('open','')
    page.keyboard.press('Enter');expect(details).to_have_attribute('open','')
    for market,expected in [('spreads','adjusted margin'),('totals','Combined score')]:
        page.locator('#market-filters [data-market="'+market+'"]').click()
        expect(page.locator('#game-grid .game-strategies')).to_have_count(3)
        expect(page.locator('#game-grid')).to_contain_text(expected)
        details=page.locator('#game-grid .game-strategies').first
        details.locator('summary').click()
        expect(details).to_have_attribute('open','')
        expect(details.locator('.strategy-option')).to_have_count(2)
        expect(details).to_contain_text(expected)
        expect(details).to_contain_text('No exact push')
        assert details.locator('button,input,form,a').count()==0
        no_overflow(page)
    page.set_viewport_size({'width':390,'height':844})
    no_overflow(page)
    page.screenshot(path=str(OUT/'mobile-total-strategies.png'),full_page=True)
    summary=details.locator('summary');summary.focus();page.clock.fast_forward(15000)
    expect(summary).to_be_focused();expect(details).to_have_attribute('open','')
    # Live-like fixture is explicitly local and used only to exercise aging, never real data.
    page.evaluate("""fixture => {
      const event = structuredClone(fixture.events[0]); event.demo=false;
      document.querySelector('#game-grid').innerHTML = BETQGameStrategies.render(event,{
        mode:'live',market:'h2h',source:'THE_ODDS_API_V4',receivedAt:fixture.receivedAt});
    }""",fixtures['h2h'])
    details=page.locator('#game-grid .game-strategies');details.locator('summary').click()
    expect(details).to_contain_text('within 10 minutes')
    summary=details.locator('summary');summary.focus();before=len(requests)
    page.clock.fast_forward(660000)
    expect(details).to_contain_text('STALE retained quote');expect(summary).to_be_focused()
    assert len(requests)==before
    assert not errors,errors
    assert not unexpected,unexpected
    assert all(r['method']=='GET' and not r['paid'] and not r['auth'] for r in requests),requests
    result={'passed':True,'requestsIntercepted':len(requests),'externalRequests':unexpected,'browserErrors':errors,
      'checks':['moneyline/spread/total pairs','source labels','unavailable markets','keyboard disclosure','repeated open/close','focus during refresh','stale quote expiry','no panel network calls','desktop/mobile overflow','no wagering controls']}
    (OUT/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
    browser.close()
