"""Offline pinned-evidence release QA: grades and historical navigation.
Every browser request is intercepted. No server, provider, credential or source refresh.
Run with pinned Python Playwright; CHROMIUM_PATH optionally selects an installed binary.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/betq-release-browser')
OUT.mkdir(parents=True, exist_ok=True)
fixtures = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
import fs from 'node:fs';
import {getBundledHistoricalEvaluation} from './src/historical-bundle.mjs';
import {gradeRetainedGames} from './src/game-grading.mjs';
import {listRetainedForecasts,listGameDossiers,buildGameDossier} from './src/game-dossier.mjs';
import {recomputeJournalEvidence} from './src/evidence-journal-feed.mjs';
import {demoEvents} from './src/demo.mjs';
import {analyzeEvents} from './src/engine.mjs';
const journal=JSON.parse(fs.readFileSync('tests/fixtures/retained-20261114/nfl-2026.json'));
const now=Math.max(...journal.snapshots.map(s=>Date.parse(s.capturedAt)),...journal.settlements.map(s=>Date.parse(s.verifiedAt)))+60000;
const view=getBundledHistoricalEvaluation(),historical=view.summary(),index=listGameDossiers(journal,{now});
console.log(JSON.stringify({now,historical,historicalGames:Object.fromEntries(historical.games.slice(0,3).map(g=>[g.gameId,view.game(g.gameId)])),
 grades:gradeRetainedGames(journal,{now}),forecasts:listRetainedForecasts(journal,{now}),index,
 summary:recomputeJournalEvidence(journal,now),dossiers:Object.fromEntries(index.games.map(g=>[g.gameId,buildGameDossier(journal,{now,gameId:g.gameId})])),
 demo:{...analyzeEvents(demoEvents('americanfootball_nfl',now),{sport:'americanfootball_nfl',asOf:now,demo:true}),receivedAt:new Date(now).toISOString(),fixtureOnly:true}}));
"""], cwd=ROOT, text=True))
requests, errors, unexpected = [], [], []
failed_grades = False
failed_game = False
static = {
    '/': 'index.html', '/historical-2025': 'historical-evaluation.html',
    **{'/'+f:f for f in ['app.js','game-strategies.js','retained-forecasts.js','game-grades.js',
        'styles.css','favicon.svg','historical-evaluation.js','historical-evaluation.css']}
}

def route_all(route):
    req = route.request
    u = urlparse(req.url)
    requests.append({'path':u.path,'query':u.query,'method':req.method,
        'paid':req.headers.get('x-betq-paid-request'),'auth':req.headers.get('authorization')})
    if u.hostname != 'betq.test':
        unexpected.append(req.url); route.abort(); return
    if u.path in static:
        f=ROOT/'public'/static[u.path]
        route.fulfill(status=200,content_type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[f.suffix],body=f.read_bytes()); return
    if u.path == '/api/historical-evaluation':
        route.fulfill(status=200,json=fixtures['historical']); return
    if u.path == '/api/historical-evaluation/game':
        game=parse_qs(u.query).get('gameId',[''])[0]
        if not failed_game and game in fixtures['historicalGames']:
            route.fulfill(status=200,json=fixtures['historicalGames'][game]); return
    if u.path == '/api/research/game':
        game=parse_qs(u.query).get('gameId',[''])[0]
        if game in fixtures['dossiers']:
            route.fulfill(status=200,json=fixtures['dossiers'][game]); return
    mapping={'/api/research/grades':'grades','/api/research/forecasts':'forecasts',
        '/api/research/games':'index','/api/evidence/nfl':'summary'}
    if u.path in mapping and not (u.path=='/api/research/grades' and failed_grades):
        route.fulfill(status=200,json=fixtures[mapping[u.path]]); return
    if u.path=='/api/slate' and parse_qs(u.query).get('mode')==['demo']:
        route.fulfill(status=200,json=fixtures['demo']); return
    route.fulfill(status=503,json={'error':{'code':'OFFLINE_FIXTURE','message':'No external request permitted.'}})

def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

def navigate(page,tab):
    if page.viewport_size['width']<=850:
        page.locator('#menu-toggle').click()
    page.locator('.nav-item[data-tab="'+tab+'"]').click()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce',service_workers='block')
    context.route('**/*',route_all)
    page=context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
    # Python Playwright numeric clock times are seconds; journal values are JS milliseconds.
    page.clock.install(time=fixtures['now']/1000)
    page.goto('http://betq.test/')
    navigate(page,'games')
    grades=page.locator('#game-grades')
    count=fixtures['grades']['coverage']['trackedGames']
    expect(grades.locator('tbody tr')).to_have_count(count)
    expect(grades).to_contain_text('0 graded / '+str(count)+' tracked games')
    expect(grades).to_contain_text('18 final scores available')
    expect(grades).to_contain_text('Original pick:')
    conflict=grades.locator('tbody tr').filter(has_text='2026_09_LV_SF')
    expect(conflict).to_contain_text('Schedule conflict: quarantined')
    expect(conflict).to_contain_text('Withheld')
    expect(grades).to_contain_text('Not scored')
    assert grades.locator('input,button,form').count()==0
    no_overflow(page)
    grades.scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'desktop-real-retained-grades.png'))
    before=grades.inner_text()
    page.locator('.mode-toggle [data-mode="demo"]').click()
    expect(grades).to_have_text(before,use_inner_text=True)
    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':844}); no_overflow(page)
        region=grades.locator('.game-grades-scroll')
        region.focus(); page.keyboard.press('ArrowRight'); expect(region).to_be_focused()
        assert region.evaluate('(el)=>el.scrollWidth>el.clientWidth')
        if width==390:
            grades.scroll_into_view_if_needed();page.screenshot(path=str(OUT/'mobile-real-retained-grades.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    failed_grades=True
    page.evaluate("""async()=>BETQGameGrades.load(document.querySelector('#game-grades'),async path=>{
      const r=await fetch(path);if(!r.ok)throw Error('offline');return r.json();})""")
    expect(grades).to_contain_text('Game grading unavailable')
    expect(grades.locator('tbody tr')).to_have_count(0)
    failed_grades=False
    # Enter through the actual terminal link, then keyboard next/back/forward.
    page.locator('.nav-item[href="/historical-2025"]').click()
    expect(page.locator('#index-status')).to_contain_text('285 frozen records loaded')
    expect(page.locator('#game-status')).to_contain_text('Frozen 2025 record loaded')
    expect(page.locator('#game option')).to_have_count(285)
    first,second=[g['gameId'] for g in fixtures['historical']['games'][:2]]
    expect(page.locator('#game')).to_have_value(first)
    page.locator('#next').focus();page.keyboard.press('Enter')
    expect(page.locator('#game')).to_have_value(second)
    expect(page.locator('#game-status')).to_contain_text('Frozen 2025 record loaded')
    page.go_back();expect(page.locator('#game')).to_have_value(first)
    page.go_forward();expect(page.locator('#game')).to_have_value(second)
    expect(page.locator('#game-status')).to_contain_text('Frozen 2025 record loaded')
    page.locator('#search').fill('NO_SUCH_TEAM_FIXTURE')
    expect(page.locator('#filter-status')).to_contain_text('0 of 285 games match')
    expect(page.locator('#game-panel')).to_be_hidden()
    expect(page.locator('#game-detail')).to_be_empty()
    page.locator('#clear-filters').click()
    expect(page.locator('#game')).to_have_value(first)
    expect(page.locator('#game-status')).to_contain_text('Frozen 2025 record loaded')
    expect(page.locator('#summary')).to_contain_text('The correction did not beat the benchmark')
    expect(page.locator('#game-detail')).to_contain_text('50 prior-season analogs')
    no_overflow(page)
    page.screenshot(path=str(OUT/'desktop-historical-summary.png'))
    page.locator('#game-panel').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT/'desktop-historical-game.png'))
    neighbors=page.locator('#game-detail details').filter(has=page.locator('summary',has_text='Inspect all 50 retained neighbors'))
    neighbors.locator('summary').focus();page.keyboard.press('Enter')
    expect(neighbors).to_have_attribute('open','')
    expect(neighbors.locator('tbody tr')).to_have_count(50)
    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':844});no_overflow(page)
        if width==390:
            page.locator('#game-panel').scroll_into_view_if_needed()
            page.screenshot(path=str(OUT/'mobile-historical-game.png'))
            neighbors.scroll_into_view_if_needed()
            page.screenshot(path=str(OUT/'mobile-historical-neighbors.png'))
    # A new page has no cached detail; an unavailable response must not show prior data.
    failed_game=True
    page.reload()
    expect(page.locator('#game-status')).to_contain_text('Game unavailable')
    expect(page.locator('#game-detail')).to_be_empty()
    failed_game=False
    page.locator('#retry-game').click()
    expect(page.locator('#game-status')).to_contain_text('Frozen 2025 record loaded')
    page.locator('#return-terminal').click()
    expect(page.locator('#page-overview')).to_have_class('page active')
    assert not errors,errors
    assert not unexpected,unexpected
    assert all(r['method']=='GET' and not r['paid'] and not r['auth'] for r in requests),requests
    report={'passed':True,'source':'Pinned real retained journal from 2026-11-14 and hash-verified historical bundle; all browser traffic intercepted',
        'trackedGames':count,'qualifiedGrades':0,'historicalGames':285,'historicalDetailRecordsExercised':2,
        'testedWidths':[320,390,768,1440],'browserErrors':errors,'externalRequests':unexpected,'requests':requests,
        'checks':['all retained grades and quarantine','missing grades not zero','demo independence','keyboard scrollable grade table',
          'unavailable clears grades','terminal historical link','keyboard next','back/forward selection','empty filter clears detail',
          'all 50 neighbors for selected record','mobile document overflow','failed historical read/retry','return terminal']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!='requests'}))
    browser.close()

# Keep the distinct fabricated reviewed-result scenario in the existing CI entrypoint.
subprocess.run([sys.executable,str(ROOT/'tests/bdl-reviewed-browser.py'),str(OUT/'reviewed-bdl')],cwd=ROOT,check=True)
