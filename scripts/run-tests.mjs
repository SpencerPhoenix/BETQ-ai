/** Launch tests in a separate process before discovering/importing any test code. */
import {spawn} from 'node:child_process';
import {isolatedTestEnvironment} from './test-environment.mjs';
const child=spawn(process.execPath,['--test',...process.argv.slice(2)],{
  cwd:process.cwd(),stdio:'inherit',
  env:isolatedTestEnvironment(process.env,new URL('./test-network-guard.mjs',import.meta.url).href)
});
child.on('error',()=>{console.error('TEST_RUNNER_START_FAILED');process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??1;if(signal)console.error('TEST_RUNNER_INTERRUPTED');});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
