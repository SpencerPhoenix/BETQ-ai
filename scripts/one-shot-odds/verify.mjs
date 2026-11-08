/** No secrets or provider access. Verify immutable baseline and dispatch approval. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {MAIN_SHA, approvedContext, contextFromEnvironment} from './run.mjs';

export function workflowBindingMatches(workflow, secretName) {
  if (typeof secretName !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(secretName)) return false;
  const marker = '      - name: Make one isolated request and print only sanitized status and quota\n';
  const sections = workflow.split(marker);
  const expected = '        env:\n' +
    '          # Existing repository secret, exposed only to the final one-request step.\n' +
    `          ODDS_ONE_SHOT_KEY: \${{ secrets.${secretName} }}\n` +
    '          ODDS_CURRENT_MAIN_SHA: ${{ steps.verify.outputs.main_sha }}\n' +
    '        run: node scripts/one-shot-odds/run.mjs\n';
  return sections.length === 2 && sections[1] === expected &&
    !/\bsecrets\b/i.test(sections[0]);
}

export function allowedDiagnosticChanges(paths) {
  const allowed = new Set(['.github/workflows/live-probe.yml',
    'scripts/one-shot-odds/README.md', 'scripts/one-shot-odds/approval.json',
    'scripts/one-shot-odds/diagnostic.test.mjs', 'scripts/one-shot-odds/run.mjs',
    'scripts/one-shot-odds/verify.mjs']);
  return Array.isArray(paths) && paths.length > 0 && paths.every(path => allowed.has(path));
}

function main() {
try {
  if (process.argv.length !== 2) throw Error('NO_ARGUMENTS');
  const config = JSON.parse(readFileSync(new URL('./approval.json', import.meta.url), 'utf8'));
  if (!approvedContext(contextFromEnvironment(process.env), config, Date.now())) throw Error('APPROVAL');
  const workflow = readFileSync('.github/workflows/live-probe.yml', 'utf8');
  if (!workflowBindingMatches(workflow, config.repositorySecretName)) throw Error('SECRET_BINDING');
  const git = args => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  if (git(['rev-parse', 'HEAD']) !== process.env.GITHUB_SHA) throw Error('REVISION');
  if (git(['status', '--porcelain'])) throw Error('DIRTY');
  const changes = git(['diff', '--name-only', MAIN_SHA, 'HEAD']).split('\n');
  if (!allowedDiagnosticChanges(changes)) throw Error('BASELINE_CHANGED');
  console.log('PASS: exact approved revision, single run number, expiry, secret binding and unchanged baseline.');
} catch { console.error('STOP: diagnostic preparation or approval is incomplete. No provider request was made.'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
