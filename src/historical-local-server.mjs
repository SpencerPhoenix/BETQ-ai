/** Standalone loopback-only viewer. Deliberately does not import the production server or providers. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {loadHistoricalEvaluation} from './historical-evaluation.mjs';
import {HISTORICAL_BUNDLE_DIR,loadBundledHistoricalEvaluation} from './historical-bundle.mjs';

const PUBLIC=resolve(dirname(fileURLToPath(import.meta.url)),'../public');
const ASSETS=new Map([['/',['historical-evaluation.html','text/html; charset=utf-8']],
  ['/historical-evaluation.js',['historical-evaluation.js','text/javascript; charset=utf-8']],
  ['/historical-evaluation.css',['historical-evaluation.css','text/css; charset=utf-8']],
  ['/favicon.svg',['favicon.svg','image/svg+xml']]]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
export function historicalHandler(view){
  if(!view||typeof view.summary!=='function'||typeof view.game!=='function')throw Error('HISTORICAL_VIEW_REQUIRED');
  return async(req,res)=>{
    const send=(status,data,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));};
    const error=(status,code)=>send(status,{error:{code,message:'Historical evaluation unavailable for this request.'}});
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||
      !/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(req.headers.host||''))return error(403,'LOCAL_ONLY');
    if(req.method!=='GET')return send(405,{error:{code:'METHOD_NOT_ALLOWED'}},{Allow:'GET'});
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return error(400,'INVALID_REQUEST');}
    try{
      if(url.pathname==='/api/historical-evaluation'){
        if([...url.searchParams].length)return error(400,'INVALID_SELECTOR');
        return send(200,view.summary());
      }
      if(url.pathname==='/api/historical-evaluation/game'){
        const pairs=[...url.searchParams];
        if(pairs.length!==1||pairs[0][0]!=='gameId'||!/^2025_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(pairs[0][1]))return error(400,'INVALID_SELECTOR');
        const game=view.game(pairs[0][1]);return game?send(200,game):error(404,'GAME_NOT_FOUND');
      }
      if(url.pathname==='/historical-source-license.txt'&&![...url.searchParams].length){
        const body=await readFile(join(HISTORICAL_BUNDLE_DIR,'SOURCE-LICENSE.txt'));res.writeHead(200,{...headers,'Content-Type':'text/plain; charset=utf-8'});return res.end(body);
      }
      const asset=ASSETS.get(url.pathname);
      if(!asset||[...url.searchParams].length)return error(404,'NOT_FOUND');
      const body=await readFile(join(PUBLIC,asset[0]));res.writeHead(200,{...headers,'Content-Type':asset[1]});res.end(body);
    }catch{return error(503,'HISTORICAL_VIEW_UNAVAILABLE');}
  };
}
export async function startHistoricalLocal({directory,port=3095}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Use optional --artifact-dir PATH and --port 0..65535');
  const view=directory?await loadHistoricalEvaluation(resolve(directory)):loadBundledHistoricalEvaluation();
  const server=http.createServer(historicalHandler(view));
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2);let directory,port=3095,invalid=false;
  for(let i=0;i<args.length;i+=2){if(args[i]==='--artifact-dir')directory=args[i+1];else if(args[i]==='--port')port=Number(args[i+1]);else invalid=true;}
  if(invalid){console.error('Use optional --artifact-dir PATH and --port NUMBER');process.exitCode=1;}
  else startHistoricalLocal({directory,port}).then(server=>console.log('[BETQ] Local historical evaluation: http://127.0.0.1:'+server.address().port+' (285 frozen games; no provider connections)'))
    .catch(error=>{console.error('[BETQ] Historical viewer did not start: '+(['FROZEN_HISTORICAL_HASH_MISMATCH','INVALID_FROZEN_HISTORICAL_ARTIFACT'].includes(error.message)?error.message:'Verify the local artifact directory and port.'));process.exitCode=1;});
}
