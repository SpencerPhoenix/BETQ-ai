"""Offline reviewed-result presentation QA. Fabricated evidence only.
All traffic is intercepted; no server, provider, credentials or live refresh.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/betq-bdl-reviewed-browser')
OUT.mkdir(parents=True, exist_ok=True)
fixtures = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', """
import {reviewedBdlFixture} from './tests/fixtures/bdl-reviewed-result.mjs';
import {reviewedResultDigest} from './src/bdl-reviewed-result.mjs';
import {gradeRetainedGames} from './src/game-grading.mjs';
import {listRetainedForecasts,listGameDossiers,buildGameDossier} from './src/game-dossier.mjs';
import {recomputeJournalEvidence} from './src/evidence-journal-feed.mjs';
const {journal,snapshot,result,now}=reviewedBdlFixture();
delete snapshot.marketOldestQuoteAt;
result.review.firstFrozenSnapshotSha256=reviewedResultDigest(snapshot);
result.review.allFrozenSnapshotsSha256=reviewedResultDigest(journal.snapshots);
journal.settlements.push(result);
console.log(JSON.stringify({now,gameId:snapshot.gameId,grades:gradeRetainedGames(journal,{now}),
 forecasts:listRetainedForecasts(journal,{now}),index:listGameDossiers(journal,{now}),
 summary:recomputeJournalEvidence(journal,now),dossier:buildGameDossier(journal,{gameId:snapshot.gameId,now})}));
"""], cwd=ROOT, text=True))
requests, errors, unexpected = [], [], []
malformed = False
static = {'/':'index.html', **{'/'+f:f for f in ['app.js','game-strategies.js','retained-forecasts.js',
    'game-grades.js','styles.css','favicon.svg']}}

def route_all(route):
    req=route.request
    u=urlparse(req.url)
    requests.append({'path':u.path,'query':u.query,'method':req.method,
        'paid':req.headers.get('x-betq-paid-request'),'auth':req.headers.get('authorization')})
    if u.hostname!='betq.test':
        unexpected.append(req.url); route.abort(); return
    if u.path in static:
        f=ROOT/'public'/static[u.path]
        route.fulfill(status=200,content_type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[f.suffix],body=f.read_bytes()); return
    mapping={'/api/research/grades':'grades','/api/research/forecasts':'forecasts',
        '/api/research/games':'index','/api/evidence/nfl':'summary'}
    if u.path in mapping:
        body=json.loads(json.dumps(fixtures[mapping[u.path]]))
        if malformed and u.path=='/api/research/grades':
            body['games'][0]['result']['qualificationDetails']['sourceAuthenticityIndependentlyVerified']=True
        route.fulfill(status=200,json=body); return
    if u.path=='/api/research/game' and parse_qs(u.query).get('gameId')==[fixtures['gameId']]:
        body=json.loads(json.dumps(fixtures['dossier']))
        if malformed: body['result']['qualificationDetails']['sourceAuthenticityIndependentlyVerified']=True
        route.fulfill(status=200,json=body); return
    route.fulfill(status=409,json={'error':{'code':'PAID_REFRESH_REQUIRED','message':'Offline fixture: provider access prohibited.'}})

def navigate(page,tab):
    if page.viewport_size['width']<=850: page.locator('#menu-toggle').click()
    page.locator('.nav-item[data-tab="'+tab+'"]').click()

def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce',service_workers='block')
    context.route('**/*',route_all)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.clock.install(time=fixtures['now']/1000)
    page.goto('http://betq.test/');navigate(page,'games')
    grades=page.locator('#game-grades');detail=page.locator('#game-dossier-content')
    expect(grades).to_contain_text('1 graded / 1 tracked games')
    expect(grades).to_contain_text('0 V2 source-corroborated grades · 1 reviewed BDL grades')
    expect(grades).to_contain_text('Market log loss: Not scored')
    opener=page.locator('#retained-games-list [data-dossier-game]').first
    opener.click()
    expect(page.locator('#game-dossier-heading')).to_be_focused()
    expect(detail).to_contain_text('0.160 / 0.511')
    expect(detail).to_contain_text('Market Brier / log lossNot scored / Not scored')
    for region in [grades,detail]:
        for label in ['BDL native final + nflverse score agreement','BALLDONTLIE_NFLVERSE_REVIEWED',
            'BDL_NATIVE_FINAL_NFLVERSE_SCORE_REVIEWED_V1','Operator-reviewed, not independently authenticated',
            'Source independence unverified','not official league certification']:
            expect(region).to_contain_text(label)
        assert all(word not in region.inner_text() for word in ['receiptSha256','bodySha256','providerGameId','ledgerSha256'])
    expect(detail).to_contain_text('Excluded from V2 aggregate reports')
    expect(detail).to_contain_text('No verified betting edge, CLV or ROI')
    for width in [320,390,768,1440]:
        page.set_viewport_size({'width':width,'height':844 if width<1000 else 1000})
        no_overflow(page)
        detail.scroll_into_view_if_needed()
        if width in [390,1440]:page.screenshot(path=str(OUT/f'synthetic-reviewed-dossier-{width}.png'))
        grades.scroll_into_view_if_needed()
        if width in [390,1440]:page.screenshot(path=str(OUT/f'synthetic-reviewed-grades-{width}.png'))
    # Repeated read-only opens, Escape, and tab navigation preserve focus and dismissal.
    page.locator('#game-dossier-heading').focus();page.keyboard.press('Escape')
    expect(page.locator('#game-dossier')).to_be_hidden();expect(opener).to_be_focused()
    opener.click();expect(detail).to_contain_text('Operator-reviewed, not independently authenticated')
    navigate(page,'evidence');expect(page.locator('#game-dossier')).to_be_hidden()
    navigate(page,'games');opener.click();expect(detail).to_contain_text('0.160 / 0.511')
    page.locator('[data-action="close-dossier"]').click();expect(page.locator('#game-dossier')).to_be_hidden()
    malformed=True
    page.reload();navigate(page,'games')
    expect(grades).to_contain_text('Game grading unavailable');expect(grades.locator('tbody tr')).to_have_count(0)
    opener.click();expect(page.locator('#game-dossier-status')).to_contain_text('Dossier unavailable')
    expect(detail).to_be_empty()
    assert not errors,errors
    assert not unexpected,unexpected
    assert all(r['method']=='GET' and not r['paid'] and not r['auth'] for r in requests),requests
    report={'passed':True,'source':'Fabricated reviewed BDL fixture; all browser requests intercepted',
        'testedWidths':[320,390,768,1440],'browserErrors':errors,'externalRequests':unexpected,
        'checks':['separate reviewed cohort','table and dossier model metrics agree','market scores absent',
          'operator-reviewed not independently authenticated','no V2 aggregate promotion','no raw receipt metadata',
          'Escape and repeated opens','dismissal across tab navigation','malformed claims fail closed','no document overflow'],
        'requests':requests}
    (OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='requests'}))
    browser.close()
