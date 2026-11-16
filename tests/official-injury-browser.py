"""Offline official-source conflict and expiry UI QA; all network intercepted."""
import json, os, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/betq-official-browser');OUT.mkdir(parents=True,exist_ok=True)
observed='2026-11-16T20:00:00.000Z'
review={'available':True,'away':'LAC','home':'BAL','sourceUrl':'https://www.chargers.com/team/injury-report/',
 'observedAt':observed,'validUntil':'2026-11-16T20:01:00.000Z','sourcePublishedAt':None,
 'conflicts':[{'team':'LAC','player':'Synthetic Receiver','officialStatus':'OUT','nflverseStatus':'QUESTIONABLE'}],
 'unmatched':[],'officialFlaggedPlayers':[{'team':'LAC','player':'Synthetic Receiver','position':'WR','status':'OUT'}]}
roster={'available':True,'away':'LAC','home':'BAL','observedAt':observed,'validUntil':'2026-11-16T20:01:00.000Z',
 'expectedQuarterback':'Synthetic Quarterback','injuredReserve':['Synthetic IR QB'],
 'sources':[{'url':'https://www.baltimoreravens.com/news/test-fixture','title':'Synthetic club article','publishedAt':'2026-11-16T16:00:00.000Z'}]}
requests=[];errors=[]
def route_all(route):
 u=urlparse(route.request.url);requests.append(route.request)
 if u.hostname!='betq.test': raise AssertionError('Unexpected network: '+route.request.url)
 if u.path=='/' or u.path in ['/app.js','/retained-forecasts.js','/game-grades.js','/game-strategies.js','/styles.css','/favicon.svg']:
  f=ROOT/'public'/('index.html' if u.path=='/' else u.path[1:]);types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}
  return route.fulfill(status=200,content_type=types[f.suffix],body=f.read_bytes())
 if u.path=='/api/injuries/nfl': return route.fulfill(status=200,json={'available':False,'reason':'INJURY_SOURCE_STALE','officialReviews':[review],'rosterContextReviews':[roster]})
 if u.path=='/api/model/efficiency': return route.fulfill(status=200,json={'available':False,'reason':'OFFLINE_TEST'})
 return route.fulfill(status=503,json={'error':{'code':'OFFLINE_TEST','message':'Offline test'}})
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
 for width in [1440,375]:
  context=browser.new_context(viewport={'width':width,'height':1000},service_workers='block');context.route('**/*',route_all)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=1794859200) # 2026-11-16 20:00 UTC
  page.goto('http://betq.test/')
  if width<850:page.locator('#menu-toggle').click()
  page.locator('.nav-item[data-tab="model"]').click()
  panel=page.locator('#intelligence-view')
  expect(panel).to_contain_text('official OUT; nflverse QUESTIONABLE')
  expect(panel).to_contain_text('Publication time unknown')
  expect(panel).to_contain_text('Synthetic Quarterback')
  expect(panel).to_contain_text('Synthetic IR QB')
  expect(panel).to_contain_text('existing model estimates do not incorporate this QB change')
  expect(page.locator('.nfl4-roster-context a')).to_have_attribute('href','https://www.baltimoreravens.com/news/test-fixture')
  expect(panel).to_contain_text('No probability adjustment')
  page.locator('.nfl4-official-review summary').click()
  expect(panel).to_contain_text('Synthetic Receiver (WR): OUT')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(OUT/f'official-{width}.png'),full_page=True)
  page.clock.fast_forward(75000)
  expect(panel).to_contain_text('OBSERVATION_EXPIRED')
  expect(page.locator('.nfl4-official-review')).to_have_count(0)
  expect(page.locator('.nfl4-roster-context')).to_have_count(0)
  context.close()
 browser.close()
assert not errors,errors
assert not any(r.headers.get('authorization') or r.headers.get('x-betq-paid-request') for r in requests)
(OUT/'report.json').write_text(json.dumps({'passed':True,'viewports':[1440,375],'requests':len(requests),'errors':errors}))
print('Official injury UI passed: conflicts, no odds dependency, expiry, desktop/mobile, zero paid calls')
