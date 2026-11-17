#!/usr/bin/env python3
"""Public nflverse listed roles only, not availability or model effects."""
import csv,gzip,hashlib,io,json,datetime,urllib.request,pathlib
now=datetime.datetime.now(datetime.timezone.utc)
season=now.year-(now.month<3)
url=f'https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_{season}.csv.gz'
with urllib.request.urlopen(url,timeout=30) as r:
    raw=r.read(25_000_001)
if len(raw)>25_000_000: raise ValueError('Source too large')
with gzip.GzipFile(fileobj=io.BytesIO(raw)) as f:
    body=f.read(150_000_001)
if len(body)>150_000_000: raise ValueError('Expanded source too large')
rows=csv.DictReader(io.StringIO(body.decode('utf-8-sig'),newline=''))
latest=None; teams={}
for r in rows:
    dt=datetime.datetime.fromisoformat(r['dt'].replace('Z','+00:00'))
    if dt.tzinfo is None or dt>now: raise ValueError('Invalid source time')
    if latest is None or dt>latest: latest=dt; teams={}
    if dt!=latest or r['pos_abb']!='QB' or r['pos_rank']!='1': continue
    p={'player':r['player_name'],'playerId':r['espn_id']}
    if r['team'] in teams and teams[r['team']]!=p: raise ValueError('Conflicting QB1')
    teams[r['team']]=p
if len(teams)!=32: raise ValueError('Incomplete latest snapshot')
iso=lambda x:x.isoformat(timespec='milliseconds').replace('+00:00','Z')
a={'schema':1,'season':season,'source':'NFLVERSE_DEPTH_CHARTS','sourceUrl':url,'sourceLoadAt':iso(latest),'collectedAt':iso(now),'sourceSha256':hashlib.sha256(raw).hexdigest(),'teams':teams}
p=pathlib.Path('data/nfl_depth_context.json')
if p.exists():
    old=json.loads(p.read_text())
    if old.get('sourceSha256')==a['sourceSha256']: print('Unchanged source');raise SystemExit
p.write_text(json.dumps(a,indent=2)+'\n')
print('Saved listed QB context',iso(latest),'not confirmed starters')
