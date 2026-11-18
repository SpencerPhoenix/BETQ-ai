/** Defense in depth: tests may open loopback fixtures, never remote TCP services. */
import net from 'node:net';
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  let options=args[0];
  if(Array.isArray(options))options=options[0];
  let host;
  if(typeof options==='object'&&options!==null){
    if(options.path)throw blocked();
    host=options.host??'localhost';
  }else if(typeof options==='number'||(typeof options==='string'&&/^\d+$/.test(options))){
    host=typeof args[1]==='string'?args[1]:'localhost';
  }else throw blocked();
  if(!['localhost','127.0.0.1','::1'].includes(host))throw blocked();
  return connect.apply(this,args);
};
function blocked(){return Object.assign(new Error('Tests permit loopback TCP fixtures only.'),{code:'TEST_NETWORK_FORBIDDEN'});}
