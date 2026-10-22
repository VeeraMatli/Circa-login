import WebSocket from 'ws';
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE;
const conversation=process.env.TEST_CONVERSATION;
function connect(token){return new Promise((resolve,reject)=>{const socket=new WebSocket(base.replace('http','ws')+'/v1/realtime/connect?conversation_id='+conversation,{headers:{Authorization:'Bearer '+token}});const timer=setTimeout(()=>reject(new Error('WebSocket open timed out')),10000);socket.once('open',()=>{clearTimeout(timer);resolve(socket);});socket.once('error',reject);});}
const first=await connect(process.env.TEST_TOKEN),second=await connect(process.env.TEST_OTHER_TOKEN);
function event(socket){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket delivery timed out')),10000);socket.once('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});});}
try{
 const events=[event(first),event(second)];
 const response=await fetch(`${base}/v1/conversations/${conversation}/messages`,{method:'POST',headers:{Authorization:'Bearer '+process.env.TEST_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({client_id:crypto.randomUUID(),body:'Delivered through a real Durable Object WebSocket.'})});
 assert.equal(response.status,200);const sent=await response.json();
 for(const received of await Promise.all(events)){assert.equal(received.type,'message');assert.equal(received.data.id,sent.data.id);}
 console.log('WebSocket broadcast reached both authorized peers.');
}finally{first.close();second.close();}
