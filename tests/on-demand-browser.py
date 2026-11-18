"""Offline desktop/mobile game card QA. No external data or paid calls."""
import os,json,sys
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/betq-analysis-browser')
OUT.mkdir(parents=True,exist_ok=True)
now='2026-11-16T20:00:00.000Z'
r={'schema':1,'gameId':'2026_10_LAC_BAL','available':True,'evaluatedAt':now,'validUntil':'2026-11-16T20:05:00.000Z','fixture':{'home':'Baltimore Ravens','away':'Los Angeles Chargers','kickoff':'2026-11-17T01:15:00.000Z','observedAt':now,'neutralSite':False},'baseline':{'homeWinProbability':.65,'awayWinProbability':.35,'modelBuiltAt':now,'throughGameDate':'2026-11-15'},'challenger':{'available':True,'generatedAt':now,'homeWinProbability':.49,'awayWinProbability':.51}}
r['depthContext']={'available':True,'validUntil':'2026-11-16T20:02:00.000Z','sourceLoadAt':now,'collectedAt':now,'teams':[{'team':'LAC','player':'Synthetic Listed QB'},{'team':'BAL','player':'Synthetic Other QB'}]}
requests=[]
mode="normal"
pending=[]
injury_pending=[]
def route(route):
 u=urlparse(route.request.url);requests.append(route.request)
 assert u.hostname=='betq.test'
 if u.path=='/api/prepared-games':
  if mode=='ledger':return route.fulfill(json={'available':True,'publicationReadbackVerified':True,'remoteLedgerObservedAt':now,'lastRunAt':now,'schedulerStale':True,'games':[{'gameId':r['gameId'],'kickoff':r['fixture']['kickoff'],'status':'PROVISIONAL_TWO_SOURCE_GRADE','captureId':'fixture','custody':{'remoteCommit':'a'*40},'forecastEvaluatedAt':now,'homeWinProbability':.65,'grade':{'homeScore':20,'awayScore':20,'tie':True,'pickWon':None,'brier':None}}]})
  return route.fulfill(json={'available':False,'publicationReadbackVerified':False})
 if u.path=='/prepared-test':return route.fulfill(body='<html><body><section id=prepared-model-ledger></section><script src=/prepared-ledger.js></script></body></html>',content_type='text/html')
 if u.path=='/api/upcoming-games':
  if mode=='delayed':pending.append(route);return
  return route.fulfill(json={'available':mode!='empty','games':[] if mode=='empty' else [{'gameId':r['gameId'],**r['fixture'],'forecastReady':not mode.startswith('scheduled'),'validUntil':('bad' if mode=='scheduled-invalid' else r['validUntil']),'kickoff':('2026-11-16T20:00:02.000Z' if mode=='scheduled-kickoff' else r['fixture']['kickoff']),'neutralSite':mode.startswith('scheduled')}],'failedWeeks':[]})
 if u.path=='/automatic-test':return route.fulfill(body='<html><head><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/styles.css></head><body><section id=automatic-game-card class=panel></section><script src=/automatic-card.js></script></body></html>',content_type='text/html')
 if u.path.startswith('/api/game-evaluation'):
  if mode=='refreshed':return route.fulfill(json={**r,'validUntil':'2026-11-16T20:10:00.000Z'})
  if mode.startswith('scheduled'):
   return route.fulfill(json={**r,'use':'SCHEDULED_MODEL_PREVIEW','preview':True,'pregameConfirmed':False,'captureEligible':False,'validUntil':('2026-11-16T20:00:02.000Z' if mode=='scheduled-kickoff' else r['validUntil']),'fixture':{**r['fixture'],'neutralSite':True}})
  if mode=='started':return route.fulfill(json={'available':False,'reason':'GAME_STARTED_OR_COMPLETED'})
  return route.fulfill(json={**r,'validUntil':now} if mode=='stale' else r)
 if u.path=='/api/injuries/nfl':
  if mode=='injury-delayed':injury_pending.append(route);return
  return route.fulfill(json={'officialReviews':[],'rosterContextReviews':[], 'matchupCoverage':{'gameId':r['gameId'],'coverage':'ONE_TEAM_WEEK_RECORD','available':True,'sourceUpdatedAt':now,'validUntil':r['validUntil'],'caveat':'DNP is not OUT. Practice may be estimated.','teams':[{'team':'BAL','teamWeekRecordPresent':True,'practiceFieldsRetained':True,'participationRecords':[{'player':'Synthetic Practice QB','practiceParticipation':'DNP','gameDesignation':'NOT_REPORTED','inactiveStatus':'NOT_VERIFIED','dateModified':None}]}],'officialSourceLinks':[]}})
 f=ROOT/'public'/('game-card.html' if u.path=='/game-card' else u.path[1:]);types={'.html':'text/html','.js':'application/javascript','.css':'text/css'}
 if f.exists():return route.fulfill(body=f.read_bytes(),content_type=types[f.suffix])
 return route.fulfill(status=404,body='not found')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True,args=['--no-sandbox'])
 for width in [375,1440]:
  c=b.new_context(viewport={'width':width,'height':1000});c.route('**/*',route);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card')
  expect(page.locator('#result')).to_contain_text('Models favor opposite teams')
  expect(page.locator('#context')).to_contain_text('Missing records do not mean healthy')
  expect(page.locator('#context')).to_contain_text('ONE_TEAM_WEEK_RECORD')
  expect(page.locator('#context')).to_contain_text('practice DNP; game designation NOT_REPORTED; inactives NOT_VERIFIED')
  expect(page.locator('#context')).to_contain_text('DNP is not OUT')
  expect(page.locator('#context')).to_contain_text('Synthetic Listed QB')
  page.locator('.context-details > summary').click()
  expect(page.locator('.pregame-comparison')).to_be_visible()
  expect(page.locator('.pregame-comparison')).to_have_count(1)
  expect(page.locator('.pregame-comparison caption')).to_contain_text('away vs home')
  expect(page.locator('.pregame-comparison')).to_contain_text('No usable team-week report')
  expect(page.locator('.pregame-comparison')).to_contain_text('Synthetic Practice QB')
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  expect(page.locator('#result')).to_contain_text('Sportsbook snapshot')
  expect(page.locator('#result')).to_contain_text('Spread analysis')
  expect(page.locator('#result')).to_contain_text('Total analysis')
  expect(page.locator('#result')).to_contain_text('Projected score Not supported')
  page.screenshot(path=str(OUT/f'analysis-{width}.png'),full_page=True)
  expect(page.locator('#context')).to_contain_text('not confirmed starter')
  assert any('gameId=2026_10_LAC_BAL' in x.url for x in requests if '/api/injuries/nfl' in x.url)
  page.locator('#price').fill('-230');page.locator('#compare').click();expect(page.locator('#comparison')).to_contain_text('69.7%')
  expect(page.locator('#comparison')).to_contain_text('Not a validated edge')
  page.clock.fast_forward(121000);expect(page.locator('#context')).not_to_contain_text('Synthetic Listed QB');expect(page.locator('#result')).to_be_visible()
  page.clock.fast_forward(301000);expect(page.locator('#quote')).to_be_hidden();expect(page.locator('#result')).to_be_hidden();expect(page.locator('#status')).to_contain_text('expired')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;c.close()
 # Isolated homepage widget uses production script/styles, verifies automatic pick and expiry.
 for width in [375,1440]:
  c=b.new_context(viewport={'width':width,'height':1000});c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/automatic-test')
  expect(page.locator('#automatic-game-card')).to_contain_text('MODEL OUTRIGHT PICK: Baltimore Ravens')
  expect(page.locator('#automatic-game-card')).to_contain_text('Current bookmaker odds: UNAVAILABLE')
  expect(page.locator('#automatic-game-card')).to_contain_text('Synthetic Listed QB')
  page.clock.fast_forward(121000);expect(page.locator('#automatic-game-card')).not_to_contain_text('Synthetic Listed QB')
  page.clock.fast_forward(301000);expect(page.locator('#automatic-game-card')).to_contain_text('expired');expect(page.locator('#automatic-game-card')).not_to_contain_text('65.0%');c.close()
 mode='scheduled'
 for width in [375,1440]:
  c=b.new_context(viewport={'width':width,'height':1000});c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc))
  before=len(requests);page.goto('http://betq.test/game-card');expect(page.locator('#result')).to_contain_text('NFL · Scheduled preview');expect(page.locator('#result')).to_contain_text('Neutral venue');expect(page.locator('#result')).to_contain_text('Preliminary outright lean');expect(page.locator('#quote')).to_be_hidden()
  assert any('preview=scheduled' in x.url for x in requests[before:])
  page.clock.fast_forward(301000);expect(page.locator('#status')).to_contain_text('expired');expect(page.locator('#result')).to_be_hidden();expect(page.locator('#upcoming')).to_contain_text('Schedule expired')
  mode='refreshed';page.locator('#upcoming').dispatch_event('change');expect(page.locator('#result')).to_contain_text('Elo baseline');expect(page.locator('#status')).not_to_contain_text('not yet available')
  mode='scheduled';page.close();page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc))
  page.goto('http://betq.test/automatic-test');expect(page.locator('#automatic-game-card')).to_contain_text('SCHEDULED MODEL PREVIEW');expect(page.locator('#automatic-game-card')).to_contain_text('PRELIMINARY OUTRIGHT LEAN');expect(page.locator('#automatic-game-card')).not_to_contain_text('MODEL OUTRIGHT PICK')
  page.clock.fast_forward(301000);expect(page.locator('#automatic-game-card')).to_contain_text('expired');c.close()
 # Kickoff invalidates a scheduled-only snapshot even if its validUntil is later.
 mode='scheduled-kickoff';c=b.new_context();c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card');expect(page.locator('#result')).to_contain_text('game-center pregame status is not confirmed');page.clock.fast_forward(3000);expect(page.locator('#status')).to_contain_text('expired')
 mode='started';page.locator('#upcoming').dispatch_event('change');expect(page.locator('#status')).to_contain_text('GAME_STARTED_OR_COMPLETED');expect(page.locator('#result')).to_be_hidden();c.close()
 # Malformed expiry must bypass cached scheduled-only status and request current evaluation.
 mode='scheduled-invalid';c=b.new_context();c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card');expect(page.locator('#result')).to_contain_text('Elo baseline');c.close()
 mode='stale';c=b.new_context();c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card');expect(page.locator('#status')).to_contain_text('No current evaluation');expect(page.locator('#result')).to_be_hidden();c.close()
 mode='injury-delayed';c=b.new_context();c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card');expect(page.locator('#result')).to_be_visible();page.clock.fast_forward(301000);expect(page.locator('#result')).to_be_hidden()
 for route_ in injury_pending:route_.fulfill(json={'officialReviews':[],'rosterContextReviews':[]})
 expect(page.locator('#context')).to_contain_text('Refresh required');c.close()
 mode='empty';c=b.new_context();c.route('**/*',route);page=c.new_page();page.goto('http://betq.test/game-card');expect(page.locator('#discovery')).to_contain_text('No current verified');expect(page.locator('#result')).to_be_hidden();c.close()
 mode='delayed';c=b.new_context();c.route('**/*',route);page=c.new_page();page.clock.install(time=datetime(2026,11,16,20,0,tzinfo=timezone.utc));page.goto('http://betq.test/game-card');page.locator('summary').first.click();page.locator('#evaluate').click();expect(page.locator('#result')).to_contain_text('Elo baseline')
 for route_ in pending:route_.fulfill(json={'available':False,'games':[]})
 expect(page.locator('#result')).to_contain_text('Elo baseline');c.close()
 c=b.new_context();c.route('**/*',route);page=c.new_page();page.goto('http://betq.test/prepared-test');expect(page.locator('#prepared-model-ledger')).to_contain_text('No automatic-save claim');c.close()
 mode='ledger';c=b.new_context();c.route('**/*',route);page=c.new_page();page.goto('http://betq.test/prepared-test');expect(page.locator('#prepared-model-ledger')).to_contain_text('Saved original forecast');expect(page.locator('#prepared-model-ledger')).to_contain_text('SCHEDULER STALE');expect(page.locator('#prepared-model-ledger')).to_contain_text('Tie: binary scores withheld');expect(page.locator('#prepared-model-ledger')).to_contain_text('not independent timestamp');c.close()
 b.close()
assert not any(x.headers.get('x-betq-paid-request') or x.headers.get('authorization') for x in requests)
print('On-demand card desktop/mobile, disagreement, arithmetic, expiry, no paid calls: PASS')
