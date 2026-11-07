"""Optional offline Chromium regression: python tests/ui-audit-browser.py [artifact-dir].
Requires Python Playwright and Chromium (CHROMIUM_PATH may override its location).
Every browser request is intercepted. Fixtures use fictional demo teams only;
no BETQ server, real provider, credentials or external network is used.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/betq-ui-browser')
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
import {demoEvents} from './src/demo.mjs';
import {analyzeEvents} from './src/engine.mjs';
const asOf=Date.now(),sport='americanfootball_nfl';
console.log(JSON.stringify({...analyzeEvents(demoEvents(sport,asOf),{sport,asOf,demo:true}),
receivedAt:new Date(asOf).toISOString(),executionGate:{bettingAuthorized:false},fixtureOnly:true}));
"""], cwd=ROOT, text=True))
requests, errors, unexpected = [], [], []
cache_ready = False

def route_all(route):
    global cache_ready
    request = route.request
    u = urlparse(request.url)
    requests.append({'path':u.path, 'query':u.query, 'paid':request.headers.get('x-betq-paid-request'), 'auth':request.headers.get('authorization')})
    if u.hostname != 'betq.test':
        unexpected.append(request.url)
        route.abort()
        return
    if u.path == '/' or u.path in ['/app.js','/styles.css','/favicon.svg']:
        f = ROOT / 'public' / ('index.html' if u.path == '/' else u.path[1:])
        content_type = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[f.suffix]
        route.fulfill(status=200, content_type=content_type, body=f.read_bytes())
        return
    if u.path == '/api/slate':
        q = parse_qs(u.query)
        if q.get('mode') == ['live'] and not cache_ready:
            route.fulfill(status=409,json={'error':{'code':'PAID_REFRESH_REQUIRED','message':'No fresh cached data.'}})
            return
        data = json.loads(json.dumps(fixture))
        # Synthetic content is retained, including source and event demo flags.
        # Mode is UI-selected independently to test its cost-intent routing.
        data['sport'] = q.get('sport',['americanfootball_nfl'])[0]
        data['market'] = q.get('market',['h2h'])[0]
        route.fulfill(status=200,json=data)
        return
    if u.path == '/api/scores':
        route.fulfill(status=200,json={'games':[], 'receivedAt':fixture['receivedAt']})
        return
    route.fulfill(status=503,json={'error':{'code':'OFFLINE_FIXTURE','message':'Not provided by offline UI fixture.'}})

def check_overflow(page, label):
    dimensions = page.evaluate('({viewport:innerWidth,width:document.documentElement.scrollWidth})')
    assert dimensions['width'] <= dimensions['viewport'], (label, dimensions)

def navigate(page, tab):
    if page.viewport_size['width'] <= 850:
        page.locator('#menu-toggle').click()
    page.locator('.nav-item[data-tab="'+tab+'"]').click()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce', service_workers='block')
    context.route('**/*', route_all)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.clock.install()
    page.goto('http://betq.test/')
    expect(page.locator('#banner')).to_contain_text('NO CACHED ODDS AVAILABLE')
    assert not any(r['paid'] for r in requests), requests
    cache_ready = True # Simulate a separate authenticated operator populating cache.
    page.locator('.refresh-btn').click()
    expect(page.locator('#banner')).to_contain_text('NO VALIDATED BETTING EDGE')
    assert len([r for r in requests if r['paid']=='true']) == 0
    cache_ready = False
    page.locator('.refresh-btn').click()
    expect(page.locator('#banner')).to_contain_text('CACHE RELOAD FAILED')
    cache_ready = True
    navigate(page,'games')
    expect(page.locator('.game-card')).to_have_count(3)
    expect(page.locator('#game-grid [data-pick]')).to_have_count(3)
    assert '4 sportsbooks · 1 matched contract(s)' in page.locator('#game-grid').inner_text()
    page.screenshot(path=str(OUT/'desktop-games.png'),full_page=True)
    page.locator('#game-grid [data-pick]').first.click()
    expect(page.locator('#page-overview')).to_have_class('page active')
    row=page.locator('#opportunity-table tr[data-pick]').first
    row.focus()
    page.keyboard.press('Enter')
    expect(page.locator('#opportunity-table tr[data-pick]').first).to_be_focused()
    navigate(page,'signals')
    pass_id = next(s['id'] for e in fixture['events'] for s in e['opportunities'] if s['status']=='PASS')
    page.locator('#signal-grid [data-watch]').evaluate_all('(els,id)=>els.find(e=>e.dataset.watch===id).click()',pass_id)
    page.locator('#watch-only').check()
    expect(page.locator('#signal-grid .signal-card')).to_have_count(1)
    expect(page.locator('#signal-grid .status-tag')).to_have_text('PASS')
    page.reload()
    expect(page.locator('#banner')).to_contain_text('NO VALIDATED BETTING EDGE')
    navigate(page,'signals')
    expect(page.locator('#watch-only')).to_be_checked()
    expect(page.locator('#signal-grid .signal-card')).to_have_count(1)
    watch = page.locator('#signal-grid [data-watch]')
    watch.focus()
    page.clock.fast_forward(15000)
    expect(page.locator('#signal-grid [data-watch]')).to_be_focused()
    page.locator('#signal-grid [data-watch]').click()
    expect(page.locator('#signal-grid')).to_contain_text('No saved signals')
    expect(page.locator('#watch-only')).to_be_focused()
    page.locator('[data-action="clear-watch-filter"]').click()
    expect(page.locator('#signal-grid .signal-card')).to_have_count(6)
    before = len([r for r in requests if r['paid']])
    page.locator('#sport-filters [data-sport="basketball_nba"]').click()
    expect(page.locator('#capability-note')).to_contain_text('No independent outcome forecast')
    page.locator('#market-filters [data-market="spreads"]').click()
    page.locator('.mode-toggle [data-mode="demo"]').click()
    expect(page.locator('#capability-note')).to_contain_text('Fictional demo only')
    page.locator('.refresh-btn').click()
    expect(page.locator('.refresh-btn')).to_be_enabled()
    assert len([r for r in requests if r['paid']]) == before
    page.locator('.mode-toggle [data-mode="live"]').click()
    expect(page.locator('.refresh-btn')).to_be_enabled()
    navigate(page,'games')
    page.locator('[data-action="scores"]').click()
    expect(page.locator('#scores')).to_contain_text('No scores returned')
    assert len([r for r in requests if r['paid']]) == before
    assert requests[-1]['path'] == '/api/scores'
    navigate(page,'execution')
    expect(page.locator('#execution-view')).to_contain_text('NEW PAPER STAGING IS LOCKED')
    expect(page.locator('#execution-view [data-tab="pricing"]')).to_be_visible()
    page.locator('#execution-view [data-tab="pricing"]').click()
    expect(page.locator('#page-pricing')).to_have_class('page active')
    for width in [320,375,768]:
        page.set_viewport_size({'width':width,'height':850})
        expect(page.locator('#menu-toggle')).to_have_attribute('aria-expanded','false')
        assert page.locator('#sidebar').evaluate('(el)=>el.inert')
        page.locator('#menu-toggle').click()
        expect(page.locator('#sidebar')).to_have_attribute('role','dialog')
        assert page.locator('#workspace').evaluate('(el)=>el.inert')
        page.locator('.nav-item').last.focus()
        page.keyboard.press('Tab')
        expect(page.locator('#menu-close')).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#menu-toggle')).to_be_focused()
        page.locator('#menu-toggle').click()
        page.locator('#nav-backdrop').click(position={'x':width-1,'y':800})
        expect(page.locator('#menu-toggle')).to_be_focused()
        for tab in ['games','signals','execution','settings']:
            navigate(page,tab)
            expect(page.locator('#page-'+tab+' h2').first).to_be_focused()
            check_overflow(page,f'{width}px {tab}')
            if width==375 and tab in ['games','execution']:
                page.screenshot(path=str(OUT/f'mobile-{tab}.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':1000})
        assert not page.locator('#sidebar').evaluate('(el)=>el.inert')
        expect(page.locator('#sidebar')).not_to_have_attribute('aria-hidden','true')
    assert not unexpected, unexpected
    assert not errors, errors
    paid = [r for r in requests if r['paid']]
    assert not paid, paid
    assert not any(r['auth'] for r in requests), requests
    (OUT/'report.json').write_text(json.dumps({'passed':True,'fixture':'fictional demo, intercepted routes only','requests':requests,'pageErrors':errors,'unexpectedExternalRequests':unexpected,'testedWidths':[320,375,768,1440]},indent=2))
    browser.close()
print('Offline browser checks passed; request intents, navigation, saved quotes, paper lock, widths and focus verified.')
