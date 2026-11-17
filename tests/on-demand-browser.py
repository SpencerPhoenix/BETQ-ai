"""Offline desktop/mobile game card QA. No external data or paid calls."""
import os,json
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
now='2026-11-16T20:00:00.000Z'
r={'schema':1,'gameId':'2026_10_LAC_BAL','available':True,'evaluatedAt':now,'validUntil':'2026-11-16T20:05:00.000Z','fixture':{'home':'Baltimore Ravens','away':'Los Angeles Chargers','kickoff':'2026-11-17T01:15:00.000Z','observedAt':now,'neutralSite':False},'baseline':{'homeWinProbability':.65,'awayWinProbability':.35,'modelBuiltAt':now,'throughGameDate':'2026-11-15'},'challenger':{'available':True,'generatedAt':now,'homeWinProbability':.49,'awayWinProbability':.51}}
requests=[]
def route(route):
 u=urlparse(route.request.url);requests.append(route.request)
 assert u.hostname=='betq.test'
 if u.path.startswith('/api/game-evaluation'):return route.fulfill(json=r)
 if u.path=='/api/injuries/nfl':return route.fulfill(json={'officialReviews':[],'rosterContextReviews':[]})
 f=ROOT/'public'/('game-card.html' if u.path=='/game-card' else u.path[1:]);types={'.html':'text/html','.js':'application/javascript','.css':'text/css'}
 if f.exists():return route.fulfill(body=f.read_bytes(),content_type=types[f.suffix])
 return route.fulfill(status=404,body='not found')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
 for width in [375,1440]:
  c=b.new_context(viewport={'width':width,'height':1000});c.route('**/*',route);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card');page.locator('#evaluate').click()
  expect(page.locator('#result')).to_contain_text('Models favor opposite teams')
  expect(page.locator('#context')).to_contain_text('Missing records do not mean healthy')
  page.locator('#price').fill('-230');page.locator('#compare').click();expect(page.locator('#comparison')).to_contain_text('69.7%')
  expect(page.locator('#comparison')).to_contain_text('Not a validated edge')
  page.clock.fast_forward(301000);expect(page.locator('#quote')).to_be_hidden();expect(page.locator('#status')).to_contain_text('expired')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;c.close()
 b.close()
assert not any(x.headers.get('x-betq-paid-request') or x.headers.get('authorization') for x in requests)
print('On-demand card desktop/mobile, disagreement, arithmetic, expiry, no paid calls: PASS')
