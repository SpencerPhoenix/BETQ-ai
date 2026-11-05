import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Publishing code cannot trigger paid evidence collection; existing collection modes remain explicit',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/capture-evidence.yml',import.meta.url),'utf8');
  const events=workflow.slice(workflow.indexOf('\non:\n'),workflow.indexOf('\npermissions:'));
  assert.doesNotMatch(events,/^  (push|pull_request|pull_request_target|workflow_run):/m);
  assert.match(events,/^  workflow_dispatch:/m);
  assert.match(events,/^  schedule:/m);
  assert.equal((events.match(/- cron:/g)||[]).length,7);
  assert.match(workflow,/if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/run: node scripts\/capture-evidence.mjs/);
});
