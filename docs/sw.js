const CACHE='our-chat-shell-v5';
const SHELL=['./','./index.html','./style.css','./telegram-theme.css','./telegram-pattern.svg','./app.js','./search-worker.js','./lottie_light.min.js','./icon.svg','./apple-touch-icon.png','./manifest.webmanifest'];
let session=null;
const decryptedParts=new Map();
self.addEventListener('message',event=>{
 if(event.data?.type==='archive-session'&&session?.sessionId!==event.data.sessionId){session=event.data;decryptedParts.clear();}
 if(event.data?.type==='archive-lock'){session=null;decryptedParts.clear();driveListings.clear();}
});
async function fetchPatiently(url,options){
 for(let attempt=0;;attempt++){
  const response=await fetch(url,options);
  if(response.ok)return response;
  if(attempt>=2||![403,429,500,502,503,504].includes(response.status))throw Error('media');
  await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
 }
}
const driveListings=new Map();
const driveIdPattern=/^[A-Za-z0-9_-]{10,200}$/;
async function driveList(parent,config){
 const files=new Map();let token='';
 do{
  const query=new URLSearchParams({q:"'"+parent+"' in parents and trashed=false",key:config.apiKey,fields:'files(id,name),nextPageToken',pageSize:'1000'});
  if(token)query.set('pageToken',token);
  const data=await(await fetchPatiently('https://www.googleapis.com/drive/v3/files?'+query,{credentials:'omit'})).json();
  for(const file of data.files||[])files.set(file.name,file.id);
  token=data.nextPageToken||'';
 }while(token);
 return files;
}
function driveChildren(parent,cacheKey,config){
 if(!driveListings.has(cacheKey))driveListings.set(cacheKey,driveList(parent,config).catch(error=>{driveListings.delete(cacheKey);throw error;}));
 return driveListings.get(cacheKey);
}
async function driveURL(path,config){
 if(!driveIdPattern.test(config.driveFolderId||'')||!driveIdPattern.test(config.apiKey||''))throw Error('media');
 const slash=path.indexOf('/'),folder=path.slice(0,slash),name=path.slice(slash+1);
 const parent=(await driveChildren(config.driveFolderId,'',config)).get(folder);if(!parent)throw Error('media');
 const id=(await driveChildren(parent,folder,config)).get(name);if(!id)throw Error('media');
 return 'https://www.googleapis.com/drive/v3/files/'+id+'?alt=media&key='+encodeURIComponent(config.apiKey);
}
async function mediaPart(path,active){
 if(session!==active)throw Error('locked');
 if(decryptedParts.has(path))return decryptedParts.get(path);
 const config=active.config;let url;
 if(config.provider==='gdrive'){
  if(config.proxyUrl){url=new URL(config.proxyUrl);url.searchParams.set('path',path);}else url=await driveURL(path,config);
 }else if(config.provider==='yandex'){
  if(config.proxyUrl){url=new URL(config.proxyUrl);url.searchParams.set('path',path);}
  else{const q=new URLSearchParams({public_key:config.yandexPublicUrl,path:'/'+path});const r=await fetch('https://cloud-api.yandex.net/v1/disk/public/resources/download?'+q,{credentials:'omit'});if(!r.ok)throw Error('media');url=(await r.json()).href;}
 }else if(config.provider==='http')url=new URL(path,config.baseUrl.endsWith('/')?config.baseUrl:config.baseUrl+'/');
 else throw Error('no-media');
 if(!url||!/^https?:/.test(String(url)))throw Error('media');
 const r=await fetchPatiently(url,{credentials:'omit',referrerPolicy:config.provider==='gdrive'&&!config.proxyUrl?'strict-origin-when-cross-origin':'no-referrer'});const ciphertext=new Uint8Array(await r.arrayBuffer());const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:ciphertext.slice(0,12)},active.key,ciphertext.slice(12)));
 if(session!==active)throw Error('locked');decryptedParts.set(path,bytes);if(decryptedParts.size>4)decryptedParts.delete(decryptedParts.keys().next().value);return bytes;
}
async function streamMedia(request,id){
 const active=session,meta=active?.media[id];
 if(!active||!meta)return new Response('Открой архив заново, чтобы загрузить медиа.',{status:401,headers:{'Cache-Control':'no-store'}});
 const size=meta.size,range=request.headers.get('Range');let first=0,last=size-1;
 if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});if(match[1]){first=Number(match[1]);if(match[2])last=Math.min(Number(match[2]),size-1);}else if(match[2])first=Math.max(0,size-Number(match[2]));else return new Response(null,{status:416});if(first>last||first>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});}
 let cursor=first,cancelled=false;
 const stream=new ReadableStream({async pull(controller){
  if(cancelled)return;
  try{if(session!==active)throw Error('locked');const partNumber=Math.floor(cursor/8388608),part=await mediaPart(meta.parts[partNumber],active),offset=cursor%8388608,count=Math.min(part.length-offset,last-cursor+1);if(count<=0)throw Error('bad-part');controller.enqueue(part.subarray(offset,offset+count));cursor+=count;if(cursor>last)controller.close();}catch(error){controller.error(error);}
 },cancel(){cancelled=true;}});
 const headers={'Content-Type':meta.mime,'Content-Length':String(last-first+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(range)headers['Content-Range']=`bytes ${first}-${last}/${size}`;
 return new Response(request.method==='HEAD'?null:stream,{status:range?206:200,headers});
}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(!['GET','HEAD'].includes(event.request.method)||new URL(event.request.url).origin!==self.location.origin)return;
 const url=new URL(event.request.url);
 const relative=url.pathname.slice(new URL(self.registration.scope).pathname.length),match=/^play-media\/([a-f0-9]{32})$/.exec(relative);
 if(match){event.respondWith(streamMedia(event.request,match[1]));return;}
 // Only the app shell is cached. Decrypted chat and media never enter the cache.
 if(!SHELL.some(p=>new URL(p,self.registration.scope).pathname===url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request)));
});
