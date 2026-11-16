import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
test('runtime major is bounded and consistent with quality-gate CI', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.engines.node, '>=26.13.1 <27');
  assert.equal(lock.packages[''].engines.node, pkg.engines.node);
  const ci = read('.github/workflows/ci.yml');
  const versions = [...ci.matchAll(/node-version:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(versions.length >= 2);
  assert.ok(versions.every(version => version === '26'));
  for(const name of readdirSync(new URL('.github/workflows/',root)).filter(x=>x.endsWith('.yml'))){
    const workflow=read('.github/workflows/'+name);
    const setups=[...workflow.matchAll(/node-version:\s*'([^']+)'\n\s*check-latest: true/g)];
    assert.ok(setups.length>0,name);assert.ok(setups.every(m=>m[1]==='26'),name);
  }
});
test('Blueprint retains locked no-lifecycle installation, gates and HTTP health path', () => {
  const yaml = read('render.yaml');
  assert.match(yaml, /buildCommand: npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test/);
  assert.match(yaml, /healthCheckPath: \/api\/health/);
  assert.match(yaml, /startCommand: npm start/);
});
