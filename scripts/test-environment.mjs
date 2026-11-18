/** No deployment configuration is inherited by unit/integration test workers. */
export function isolatedTestEnvironment(parent,guardUrl) {
  const env={};
  for(const key of ['PATH','SystemRoot','SYSTEMROOT','WINDIR','TMPDIR','TMP','TEMP']){
    if(typeof parent[key]==='string')env[key]=parent[key];
  }
  return {...env,TZ:'UTC',LANG:'C.UTF-8',NODE_ENV:'test',
    // Propagates to subprocess tests as well, without inheriting caller preloads.
    NODE_OPTIONS:`--import=${guardUrl}`};
}
