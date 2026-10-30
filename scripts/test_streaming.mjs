import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const handlers={},id='a'.repeat(32),plain=new Uint8Array(8388608+31);
for(let i=0;i<plain.length;i++)plain[i]=i%251;
const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),files=new Map();
for(let i=0;i<2;i++){
 const iv=webcrypto.getRandomValues(new Uint8Array(12)),data=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,plain.slice(i*8388608,(i+1)*8388608));
 const bytes=new Uint8Array(12+data.byteLength);bytes.set(iv);bytes.set(new Uint8Array(data),12);files.set(`aa/${id}.${String(i).padStart(3,'0')}.bin`,bytes);
}
const self={location:{origin:'https://archive.test'},registration:{scope:'https://archive.test/'},addEventListener:(name,fn)=>handlers[name]=fn};
const context=vm.createContext({self,URL,Request,Response,ReadableStream,Uint8Array,Map,Number,String,Error,crypto:webcrypto,fetch:async url=>{
 const path=new URL(url).pathname.slice(1);assert(files.has(path),'Unexpected storage request');return new Response(files.get(path));
}});
vm.runInContext(await readFile(new URL('../web/sw.js',import.meta.url),'utf8'),context);
handlers.message({data:{type:'archive-session',sessionId:'qa-session',key,config:{provider:'http',baseUrl:'https://media.test/'},media:{[id]:{size:plain.length,mime:'video/mp4',parts:[...files.keys()]}}}});
async function request(range){let promise;handlers.fetch({request:new Request('https://archive.test/play-media/'+id,{headers:range?{Range:range}:{}}),respondWith:p=>promise=p});return promise;}
for(const [range,a,b] of [['bytes=0-1',0,2],['bytes=8388606-8388611',8388606,8388612],['bytes=-7',plain.length-7,plain.length],['bytes=8388610-',8388610,plain.length]]){
 const r=await request(range);assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),`bytes ${a}-${b-1}/${plain.length}`);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),plain.slice(a,b));
}
assert.equal((await request('bytes=99999999-')).status,416);
handlers.message({data:{type:'archive-lock'}});assert.equal((await request('bytes=0-1')).status,401);
console.log('Streaming verified: initial range, cross-part range, suffix, open-ended range, invalid range, locked access.');
