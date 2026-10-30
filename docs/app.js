const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const ICONS={back:'m15 5-7 7 7 7',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',calendar:'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2m-8 4h2',grid:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',down:'m6 9 6 6 6-6',up:'m6 15 6-6 6 6',close:'m6 6 12 12M6 18 18 6',lock:'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3m-4 5v2',settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',play:'m9 5 10 7-10 7z',file:'M5 2h9l5 5v15H5zM14 2v6h5',voice:'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3M5 10v1a7 7 0 0 0 14 0v-1m-7 8v4m-4 0h8',photo:'M3 3h18v18H3zm0 13 5-6 5 5 3-4 5 7M16 7h.01'};
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',ICONS[name]||ICONS.file);s.append(p);return s;}
ICONS.clip='M8 13.5 15.5 6a3 3 0 0 1 4.2 4.2L9.5 20.4a5 5 0 0 1-7.1-7.1L13 2.7a3.5 3.5 0 0 1 5 5L7.7 18a2 2 0 0 1-2.8-2.8L15 5.1';
ICONS.smile='M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 9h.01M16 9h.01M7.5 14a5 5 0 0 0 9 0';
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{const name=el.dataset.icon;el.removeAttribute('data-icon');el.prepend(icon(name));});}
hydrateIcons();
function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;}
function button(cls,txt,fn){const b=el('button',cls,txt);b.type='button';if(fn)b.onclick=fn;return b;}
function storageGet(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function storageSet(key,value){try{localStorage.setItem(key,value);}catch{}}
let archive=null,key=null,mediaConfig=null,indexById=new Map(),chunkCache=new Map(),blobCache=new Map(),renderGeneration=0,sessionGeneration=0,sessionToken='';
let start=0,end=0,busy=false,currentIndex=0,lastSheetFocus=null,searchWorker=null,searchSequence=0,results=[],resultPosition=-1,currentQuery='',searchTimer=null,saveTimer=null,toastTimer=null,viewAsset=null,stickerAnimation=null;
let prefs={theme:storageGet('chat-theme-v2','reference'),large:storageGet('chat-large','false')==='true',contact:storageGet('chat-contact','егорка'),perspective:Number(storageGet('chat-perspective','1'))};
function syncMediaSession(){if(key&&archive&&navigator.serviceWorker?.controller)navigator.serviceWorker.controller.postMessage({type:'archive-session',sessionId:sessionToken,key,media:archive.media,config:mediaConfig});}
async function streamingURL(id){
 if(!mediaConfig||mediaConfig.provider==='none')throw Error('no-media');
 if(!archive?.media[id])throw Error('missing');
 if(!navigator.serviceWorker?.controller)return resolveAsset(id);
 syncMediaSession();return new URL('play-media/'+id,location.href).href;
}
const zone='Europe/Moscow', dateFmt=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:zone}),shortFmt=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:zone});
function displayDate(value,full=false){return (full?dateFmt:shortFmt).format(new Date(value.length===10?value+'T12:00:00+03:00':value));}
function senderName(sender){return sender===1?'Ты':prefs.contact;}
function applyPrefs(){document.body.dataset.chatSkin=prefs.theme==='reference'?'reference':'classic';document.body.dataset.theme=prefs.theme==='reference'?'dark':prefs.theme==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):prefs.theme;document.body.classList.toggle('large-text',prefs.large);$$('.contact-name').forEach(x=>x.textContent=prefs.contact);$$('.avatar').forEach(x=>x.textContent=prefs.contact.slice(0,1).toUpperCase());if(prefs.theme==='reference')$('#menu-open').textContent='🤩';document.querySelector('meta[name="theme-color"]').content=prefs.theme==='reference'?'#000000':document.body.dataset.theme==='dark'?'#1c2625':'#f3f4f6';}
applyPrefs();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyPrefs);
const scrollBox=$('#messages'),timeline=$('#timeline');
function notify(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
async function fetchChecked(url,options){const response=await fetch(url,options);if(!response.ok)throw Error(`HTTP ${response.status}`);return response;}
async function decrypt(bytes,activeKey=key){const data=new Uint8Array(bytes);return crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12)},activeKey,data.slice(12));}
async function readJSON(path,activeKey=key){const response=await fetchChecked(path);const bytes=await decrypt(await response.arrayBuffer(),activeKey);const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text());}
async function deriveKey(password,config){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:Uint8Array.from(atob(config.salt),c=>c.charCodeAt(0)),iterations:config.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);}
$('#show-password').onclick=()=>{const p=$('#password');p.type=p.type==='password'?'text':'password';$('#show-password').setAttribute('aria-label',p.type==='password'?'Показать пароль':'Скрыть пароль');};
$('#unlock-form').onsubmit=async event=>{
 event.preventDefault();const b=$('#unlock');b.disabled=true;$('#unlock-status').textContent='Открываем нашу историю…';
 try{
  if(!crypto.subtle||!window.DecompressionStream)throw Error('unsupported');
  const config=await (await fetchChecked('archive.json',{cache:'no-store'})).json();
  const derived=await deriveKey($('#password').value,config);const imported=await readJSON(config.index,derived);
  key=derived;archive=imported;sessionGeneration++;sessionToken=crypto.randomUUID();indexById=new Map(archive.messages.map((m,i)=>[m[0],i]));
  try{mediaConfig=await(await fetchChecked('media-config.json',{cache:'no-store'})).json();}catch{mediaConfig={provider:'none'};}
  syncMediaSession();
  searchWorker=new Worker('search-worker.js');searchWorker.postMessage({type:'init',rows:archive.messages});searchWorker.onmessage=handleSearch;
  $('#password').value='';$('#lock-screen').hidden=true;$('#app').hidden=false;$('#unlock-status').textContent='';
  $('#side-range').textContent=displayDate(archive.first,true)+' — '+displayDate(archive.last,true);
  const saved=Number(storageGet('chat-position','NaN'));await jump(Number.isFinite(saved)?Math.max(0,Math.min(saved,archive.messages.length-1)):archive.messages.length-1);
 }catch(error){console.error('Archive unlock failed:',error.name);key=null;archive=null;$('#unlock-status').textContent=error.message==='unsupported'?'Для архива нужен Safari 16.4 или новее. Обнови iOS и попробуй снова.':error.name==='OperationError'?'Пароль не подошёл. Попробуй ещё раз.':'Не удалось открыть архив. Проверь подключение к интернету.';}
 finally{b.disabled=false;}
};
function closeArchive(){
 navigator.serviceWorker?.controller?.postMessage({type:'archive-lock'});sessionGeneration++;renderGeneration++;archive=null;key=null;busy=false;imageObserver.disconnect();chunkCache.clear();inflightMedia.clear();indexById.clear();searchWorker?.terminate();searchWorker=null;results=[];resultPosition=-1;currentQuery='';clearTimeout(searchTimer);clearTimeout(saveTimer);$('#search-input').value='';$('#search-bar').hidden=true;$('#search-navigation').hidden=true;$('#menu').hidden=true;closeSheet();closeViewer();for(const v of blobCache.values())URL.revokeObjectURL(v);blobCache.clear();timeline.replaceChildren();$('#app').hidden=true;$('#lock-screen').hidden=false;$('#password').focus();
}
async function getChunk(number){
 if(chunkCache.has(number))return chunkCache.get(number);
 const activeSession=sessionGeneration,activeKey=key;
 const task=readJSON('data/'+archive.chunks[number],activeKey).catch(e=>{chunkCache.delete(number);throw e;});chunkCache.set(number,task);
 if(chunkCache.size>8){const oldest=chunkCache.keys().next().value;if(oldest!==number)chunkCache.delete(oldest);}
 const value=await task;if(activeSession!==sessionGeneration)throw Error('locked');return value;
}
async function getMessage(i){const chunk=await getChunk(Math.floor(i/archive.chunkSize));return chunk[i%archive.chunkSize];}
function cleanHTML(content){
 // A second allowlist at the rendering boundary, including for rebuilt archives.
 const doc=new DOMParser().parseFromString('<body>'+content,'text/html'),allowed=new Set(['A','B','STRONG','I','EM','U','S','DEL','CODE','PRE','BR','SPAN','BLOCKQUOTE']);
 for(const node of [...doc.body.querySelectorAll('*')]){
  if(!allowed.has(node.tagName)){node.replaceWith(document.createTextNode(node.textContent));continue;}
  const href=node.tagName==='A'?node.getAttribute('href'):null;for(const attr of [...node.attributes])node.removeAttribute(attr.name);
  if(href&&/^(https?:|mailto:|tel:|tg:)/i.test(href)){node.setAttribute('href',href);node.target='_blank';node.rel='noopener noreferrer';}
 }
 const fragment=document.createDocumentFragment();fragment.append(...doc.body.childNodes);return fragment;
}
function highlightText(root,query){
 if(!query)return;const norm=s=>s.toLocaleLowerCase('ru').replaceAll('ё','е'),q=norm(query);const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes){const original=node.textContent,normalized=norm(original);let pos=0,match=normalized.indexOf(q),fragment=document.createDocumentFragment();if(match<0)continue;while(match>=0){fragment.append(document.createTextNode(original.slice(pos,match)));fragment.append(el('mark','',original.slice(match,match+q.length)));pos=match+q.length;match=normalized.indexOf(q,pos);}fragment.append(document.createTextNode(original.slice(pos)));node.replaceWith(fragment);}
}
function createMessage(m,i){
 if(m.service){const e=el('div','service-message',m.text);e.dataset.index=i;return e;}
 const row=el('article','msg-row'+(m.sender===prefs.perspective?' out':''));row.dataset.index=i;row.id='message-'+m.id;
 if(m.text&&!m.media&&!m.reply&&m.text.length<=40&&!m.text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]/gu,''))row.classList.add('emoji-only');
 const next=archive.messages[i+1];if(!next||next[2]!==m.sender||next[1].slice(0,10)!==m.day)row.classList.add('group-end');
 const bubble=el('div','bubble');row.append(bubble);
 if(m.forwarded)bubble.append(el('div','forwarded','Переслано от '+m.forwarded));
 if(m.reply){const ri=indexById.get(m.reply),r=archive.messages[ri];const reply=button('reply','',()=>{if(ri===undefined)notify('Это сообщение отсутствует в экспорте');else jump(ri);});reply.append(el('strong','',r?senderName(r[2]):'Ответ на сообщение'),el('span','',r?(r[3]||mediaLabel(r[4])):'Сообщение отсутствует в экспорте'));bubble.append(reply);}
 if(m.media)bubble.append(createMedia(m));
 if(m.text){const content=el('div','message-text');content.append(m.html?cleanHTML(m.html):document.createTextNode(m.text));highlightText(content,currentQuery);bubble.append(content);}
 const time=el('time','bubble-time',m.date.slice(11,16));time.dateTime=m.date;time.title=displayDate(m.date,true)+' '+m.date.slice(11,19);if(m.sender===prefs.perspective){const ticks=el('span','ticks','✓✓');ticks.setAttribute('aria-label','Сохранено в архиве');time.append(ticks);}bubble.append(time);
 if(m.reactions?.length){const reactions=el('div','reactions');for(const r of m.reactions)reactions.append(el('span','reaction',r));bubble.append(reactions);}
 return row;
}
function visibleAnchor(){const box=scrollBox.getBoundingClientRect();for(const node of timeline.querySelectorAll('[data-index]')){const r=node.getBoundingClientRect();if(r.bottom>box.top+12)return {i:Number(node.dataset.index),offset:r.top-box.top};}return {i:currentIndex,offset:20};}
async function renderRange(from,to,{target=null,preserve=null}={}){
 const generation=++renderGeneration;busy=true;
 try{
  const records=await Promise.all(Array.from({length:to-from},(_,n)=>getMessage(from+n)));
  if(generation!==renderGeneration||!archive)return;
  const fragment=document.createDocumentFragment();if(from>0)fragment.append(button('load-more','Более ранние сообщения',()=>extend(-1)));
  let day='';for(let n=0;n<records.length;n++){const m=records[n];if(m.day!==day){day=m.day;const sep=el('div','day-separator');sep.append(button('',displayDate(day,true),()=>openCalendar(day)));fragment.append(sep);}fragment.append(createMessage(m,from+n));}
  if(to<archive.messages.length)fragment.append(button('load-more','Более поздние сообщения',()=>extend(1)));
  start=from;end=to;imageObserver.disconnect();timeline.replaceChildren(fragment);timeline.querySelectorAll('img[data-asset]').forEach(image=>imageObserver.observe(image));
  if(preserve){const node=timeline.querySelector(`[data-index="${preserve.i}"]`);if(node)scrollBox.scrollTop+=node.getBoundingClientRect().top-scrollBox.getBoundingClientRect().top-preserve.offset;}
  else if(target!==null){const node=timeline.querySelector(`[data-index="${target}"]`);if(node){scrollBox.scrollTop+=node.getBoundingClientRect().top-scrollBox.getBoundingClientRect().top-Math.max(65,scrollBox.clientHeight*.35);node.classList.add('highlight');setTimeout(()=>node.classList.remove('highlight'),1800);}if(target===archive.messages.length-1)scrollBox.scrollTop=scrollBox.scrollHeight;}
  updateScroll();
 }catch(error){if(error.message!=='locked')notify('Не удалось загрузить сообщения. Проверь интернет и попробуй снова.');}
 finally{if(generation===renderGeneration)busy=false;}
}
async function jump(i){if(!archive)return;i=Math.max(0,Math.min(i,archive.messages.length-1));currentIndex=i;await renderRange(Math.max(0,i-75),Math.min(archive.messages.length,i+85),{target:i});}
async function extend(direction){if(busy||!archive)return;const anchor=visibleAnchor();if(direction<0&&start>0)await renderRange(Math.max(0,start-65),Math.min(end,Math.max(0,start-65)+230),{preserve:anchor});else if(direction>0&&end<archive.messages.length)await renderRange(Math.max(start,Math.min(archive.messages.length,end+65)-230),Math.min(archive.messages.length,end+65),{preserve:anchor});}
function updateScroll(){
 if(!archive)return;const box=scrollBox.getBoundingClientRect();if(prefs.theme==='reference')for(const bubble of timeline.querySelectorAll('.out .bubble')){const r=bubble.getBoundingClientRect();if(r.bottom>=box.top&&r.top<=box.bottom){const fraction=Math.max(0,Math.min(1,(r.top+r.height/2-box.top)/box.height));bubble.style.setProperty('--bubble-hue',String(Math.round(280-42*fraction)));}}const anchor=visibleAnchor();currentIndex=anchor.i;const row=archive.messages[currentIndex];if(row)$('#floating-day').textContent=displayDate(row[1],true);$('#floating-day').classList.toggle('visible',scrollBox.scrollTop>80);$('#jump-latest').hidden=end>=archive.messages.length&&scrollBox.scrollHeight-scrollBox.scrollTop-scrollBox.clientHeight<250;clearTimeout(saveTimer);saveTimer=setTimeout(()=>storageSet('chat-position',String(currentIndex)),400);
}
let ticking=false;scrollBox.addEventListener('scroll',()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{ticking=false;updateScroll();if(!busy&&scrollBox.scrollTop<160)extend(-1);else if(!busy&&scrollBox.scrollHeight-scrollBox.scrollTop-scrollBox.clientHeight<200)extend(1);});},{passive:true});
$('#jump-latest').onclick=()=>jump(archive.messages.length-1);$('#floating-day').onclick=()=>openCalendar(archive.messages[currentIndex]?.[1].slice(0,10));
function openSheet(title){$('#menu').hidden=true;lastSheetFocus=document.activeElement;$('#sheet-title').textContent=title;$('#sheet-content').replaceChildren();$('#sheet-backdrop').hidden=false;$('#sheet').hidden=false;$('#sheet-close').focus();return $('#sheet-content');}
function closeSheet(){$('#sheet').hidden=true;$('#sheet-backdrop').hidden=true;if(lastSheetFocus?.isConnected)lastSheetFocus.focus();}
$('#sheet-close').onclick=closeSheet;$('#sheet-backdrop').onclick=closeSheet;
function openCalendar(selected){
 if(!archive)return;selected=(selected||archive.messages[currentIndex]?.[1]||archive.last).slice(0,10);let month=selected.slice(0,7);const content=openSheet('Перейти к дате');
 function draw(){content.replaceChildren();const [y,m]=month.split('-').map(Number),nav=el('div','calendar-nav');const prev=button('icon-button','',()=>{month=new Date(Date.UTC(y,m-2,15)).toISOString().slice(0,7);draw();});prev.append(icon('back'));prev.setAttribute('aria-label','Предыдущий месяц');prev.disabled=month<=archive.first.slice(0,7);const next=button('icon-button','',()=>{month=new Date(Date.UTC(y,m,15)).toISOString().slice(0,7);draw();});const nextIcon=icon('back');nextIcon.style.transform='rotate(180deg)';next.append(nextIcon);next.setAttribute('aria-label','Следующий месяц');next.disabled=month>=archive.last.slice(0,7);nav.append(prev,el('strong','',new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,15)))),next);content.append(nav);
 const weekdays=el('div','weekdays');['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].forEach(d=>weekdays.append(el('span','',d)));content.append(weekdays);const grid=el('div','calendar-days'),offset=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;for(let n=0;n<offset;n++)grid.append(el('span'));
 for(let d=1;d<=new Date(Date.UTC(y,m,0)).getUTCDate();d++){const day=month+'-'+String(d).padStart(2,'0');const b=button((day in archive.days?'has-chat ':'')+(day===selected?'selected':''),String(d),()=>{closeSheet();jump(archive.days[day]);});b.disabled=!(day in archive.days);b.setAttribute('aria-label',displayDate(day,true));grid.append(b);}content.append(grid);
 const bottom=el('div','calendar-bottom');bottom.append(el('span','','Выбрать точную дату'));const date=el('input');date.type='date';date.min=archive.first;date.max=archive.last;date.value=selected;date.setAttribute('aria-label','Точная дата');date.onchange=()=>{const day=date.value;if(day in archive.days){closeSheet();jump(archive.days[day]);}else notify('В этот день в экспорте нет сообщений');};bottom.append(date);content.append(bottom);content.append(button('full-button','К самому началу',()=>{closeSheet();jump(0);}));
 }draw();
}
$('#calendar-open').onclick=()=>openCalendar();$('#search-calendar').onclick=()=>openCalendar();
function openSearch(){$('#menu').hidden=true;$('#search-bar').hidden=false;$('#search-input').focus();}
function closeSearch(){searchSequence++;$('#search-bar').hidden=true;$('#search-navigation').hidden=true;$('#search-input').value='';currentQuery='';results=[];resultPosition=-1;$('#search-summary').textContent='';if(archive)jump(currentIndex);}
$('#search-open').onclick=openSearch;$('#search-close').onclick=closeSearch;$('#clear-search').onclick=()=>{$('#search-input').value='';runSearch();$('#search-input').focus();};
$('#footer-search').onclick=openSearch;
function runSearch(){clearTimeout(searchTimer);currentQuery=$('#search-input').value.trim();$('#search-summary').textContent=currentQuery?'Ищем…':'';searchWorker?.postMessage({type:'search',seq:++searchSequence,query:currentQuery,sender:$('#search-sender').value});}
$('#search-input').oninput=()=>{clearTimeout(searchTimer);searchSequence++;searchTimer=setTimeout(runSearch,220);};$('#search-sender').onchange=runSearch;
function handleSearch({data}){if(data.seq!==searchSequence||!archive)return;results=data.results;resultPosition=results.length-1;$('#search-summary').textContent=currentQuery?(results.length?new Intl.NumberFormat('ru-RU').format(results.length)+' совпадений':'Ничего не найдено'):'';$('#search-navigation').hidden=!currentQuery||!results.length;updateResultNav();if(results.length)jump(results[resultPosition]);else jump(currentIndex);}
function updateResultNav(){$('#search-position').textContent=results.length?`${resultPosition+1} из ${results.length}`:'';$('#previous-result').disabled=resultPosition<=0;$('#next-result').disabled=resultPosition>=results.length-1;}
function selectResult(position){if(position<0||position>=results.length)return;resultPosition=position;updateResultNav();jump(results[position]);}
$('#previous-result').onclick=()=>selectResult(resultPosition-1);$('#next-result').onclick=()=>selectResult(resultPosition+1);
$('#show-results').onclick=()=>{
 const content=openSheet('Результаты поиска');let shown=0;const caption=el('p','sheet-caption',`«${currentQuery}» · ${results.length} совпадений`);content.append(caption);
 function more(){content.querySelector('.load-more')?.remove();for(let n=shown;n<Math.min(shown+70,results.length);n++){const position=results.length-1-n,i=results[position],r=archive.messages[i],b=button('result','',()=>{closeSheet();selectResult(position);});const meta=el('div','result-meta');meta.append(el('strong','',senderName(r[2])),el('span','',displayDate(r[1],true)));const text=el('div','result-text',r[3]);highlightText(text,currentQuery);b.append(meta,text);content.append(b);}shown+=70;if(shown<results.length)content.append(button('load-more','Показать ещё',more));}more();
};
function mediaLabel(kind){return {photo:'Фотография',video:'Видео',round:'Видеосообщение',voice:'Голосовое сообщение',audio:'Аудиозапись',sticker:'Стикер',file:'Файл'}[kind]||'Сообщение';}
function createMedia(m){
 const media=m.media,meta=archive.media[media.asset];
 if(media.kind==='call'||media.kind==='contact'||media.missing){
  const wrap=el('div','file-button'),badge=el('span','file-icon');badge.append(icon(media.kind==='call'?'voice':media.kind==='contact'?'file':'lock'));const copy=el('span','file-copy');let title=media.title,detail=media.detail;
  if(media.kind==='call'){title='Звонок';detail=detail.replace(/Outgoing \((\d+) seconds\)/,(_,n)=>'Исходящий · '+Math.floor(n/60)+':'+String(n%60).padStart(2,'0')).replace(/Incoming \((\d+) seconds\)/,(_,n)=>'Входящий · '+Math.floor(n/60)+':'+String(n%60).padStart(2,'0')).replace('Declined','Отклонён').replace('Missed','Пропущен').replace('Cancelled','Отменён');}
  else if(media.missing&&media.kind!=='contact'){title=title.replace('Self-destructing photo','Исчезающее фото').replace('Self-destructing video','Исчезающее видео').replace(/^Photo$/,'Фото').replace(/^Video$/,'Видео');detail=detail==='Expired'?'Срок хранения истёк':'Файл не сохранён в экспорте';}
  copy.append(el('strong','',title||mediaLabel(media.kind)),el('small','',detail||''));wrap.append(badge,copy);return wrap;
 }
 if(['voice','audio','file'].includes(media.kind)){
  const wrap=el('div'),b=button('file-button','',()=>loadInlineMedia(wrap,media,m));const image=el('span','file-icon');image.append(icon(media.kind==='voice'?'play':media.kind==='audio'?'play':'file'));const copy=el('span','file-copy');
  if(media.kind==='voice'){const waveform=el('span','waveform');for(let n=0;n<38;n++){const bar=el('i');bar.style.height=(6+((m.id*(n+7)*13)%22))+'px';waveform.append(bar);}copy.append(waveform,el('small','',media.detail||'Голосовое сообщение'));}else copy.append(el('strong','',media.title||meta?.name||mediaLabel(media.kind)),el('small','',media.detail||''));b.append(image,copy);wrap.append(b);return wrap;
 }
 const b=button('media-button '+media.kind,'',()=>openMedia(media,m));b.setAttribute('aria-label',mediaLabel(media.kind));const thumb=media.thumb||(media.kind==='photo'||media.kind==='sticker'?media.asset:null);
 if(thumb){const image=el('img');image.alt=mediaLabel(media.kind);image.loading='lazy';b.append(image);observeImage(image,thumb);}else b.append(el('span','media-caption',media.kind==='sticker'?(media.detail||'Стикер'):mediaLabel(media.kind)));
 if(media.kind==='video'||media.kind==='round'){const overlay=el('span','media-overlay'),play=el('span','play-badge');play.append(icon('play'));overlay.append(play);b.append(overlay);}return b;
}
const imageObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){imageObserver.unobserve(entry.target);const image=entry.target,id=image.dataset.asset;resolveAsset(id).then(url=>{if(image.isConnected)image.src=url;}).catch(()=>{if(image.isConnected){image.removeAttribute('src');image.alt=mediaConfig?.provider==='none'?'Медиа ещё не подключены':'Нажми, чтобы открыть медиа';}});}}},{rootMargin:'250px'});
function observeImage(image,id){image.dataset.asset=id;imageObserver.observe(image);}
// Google answers a burst of requests with 403 rateLimitExceeded or 429, so a part is worth retrying.
async function fetchPatiently(url,options){
 for(let attempt=0;;attempt++){
  try{return await fetchChecked(url,options);}
  catch(error){
   if(attempt>=2||!/^HTTP (403|429|5\d\d)$/.test(error.message))throw error;
   await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
  }
 }
}
// Google Drive has no addressable paths: each folder is listed once and its names are mapped to file ids.
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
 if(!driveIdPattern.test(config.driveFolderId||'')||!driveIdPattern.test(config.apiKey||''))throw Error('media-config');
 const slash=path.indexOf('/'),folder=path.slice(0,slash),name=path.slice(slash+1);
 const parent=(await driveChildren(config.driveFolderId,'',config)).get(folder);
 if(!parent)throw Error('missing-folder');
 const id=(await driveChildren(parent,folder,config)).get(name);
 if(!id)throw Error('missing-part');
 return 'https://www.googleapis.com/drive/v3/files/'+id+'?alt=media&key='+encodeURIComponent(config.apiKey);
}
async function fetchPart(path){
 const config=mediaConfig;if(!config||config.provider==='none')throw Error('no-media');
 let url;
 if(config.provider==='gdrive'){
  if(config.proxyUrl){url=new URL(config.proxyUrl);url.searchParams.set('path',path);}else url=await driveURL(path,config);
 }else if(config.provider==='yandex'){
  const query=new URLSearchParams({public_key:config.yandexPublicUrl,path:'/'+path});
  if(config.proxyUrl){url=new URL(config.proxyUrl);url.searchParams.set('path',path);}else{const response=await fetchChecked('https://cloud-api.yandex.net/v1/disk/public/resources/download?'+query);url=(await response.json()).href;}
 }else if(config.provider==='http'){url=new URL(path,config.baseUrl.endsWith('/')?config.baseUrl:config.baseUrl+'/');}
 else throw Error('unsupported-provider');
 if(!url||!/^https?:/.test(String(url)))throw Error('invalid-media-url');
 // A Google API key may be restricted by referrer, so that request keeps the origin.
 return (await fetchPatiently(url,{credentials:'omit',referrerPolicy:config.provider==='gdrive'&&!config.proxyUrl?'strict-origin-when-cross-origin':'no-referrer'})).arrayBuffer();
}
const inflightMedia=new Map();
async function resolveAsset(id){
 if(!id)throw Error('missing');if(blobCache.has(id))return blobCache.get(id);if(inflightMedia.has(id))return inflightMedia.get(id);if(!archive)throw Error('locked');
 const meta=archive.media[id];if(!meta)throw Error('missing');const activeSession=sessionGeneration,activeKey=key;
 const task=(async()=>{const chunks=[];for(const part of meta.parts){if(activeSession!==sessionGeneration)throw Error('locked');chunks.push(await decrypt(await fetchPart(part),activeKey));}if(activeSession!==sessionGeneration)throw Error('locked');const url=URL.createObjectURL(new Blob(chunks,{type:meta.mime}));blobCache.set(id,url);if(blobCache.size>65){const oldest=blobCache.keys().next().value;if(oldest!==viewAsset&&oldest!==id){URL.revokeObjectURL(blobCache.get(oldest));blobCache.delete(oldest);}}return url;})();
 inflightMedia.set(id,task);try{return await task;}finally{inflightMedia.delete(id);}
}
// The worker stream needs the session the page posted to it; after the worker is replaced or evicted
// that session is gone, so playback falls back to downloading the whole file in the page.
async function playWithoutWorker(element,media,activeSession,message){
 if(element.dataset.fallback)return notify(message);
 element.dataset.fallback='1';
 try{
  const direct=await resolveAsset(media.asset);
  if(activeSession!==sessionGeneration||!element.isConnected)return;
  element.src=direct;element.load();element.play().catch(()=>{});
 }catch(error){if(error.message!=='locked')notify(message);}
}
function mediaError(error){return error.message==='no-media'?'Вложения ещё не подключены. Текст переписки уже доступен.':error.message==='missing'?'Этот файл отсутствует в экспорте.':'Не удалось загрузить файл из облака. Попробуй ещё раз.';}
async function loadInlineMedia(wrap,media,m){
 if(media.kind==='file')return openMedia(media,m);const activeSession=sessionGeneration,b=wrap.querySelector('button');b.disabled=true;
 try{const url=await streamingURL(media.asset);if(activeSession!==sessionGeneration||!wrap.isConnected)return;const audio=el('audio','audio-player');audio.controls=true;audio.preload='metadata';audio.src=url;audio.onerror=()=>playWithoutWorker(audio,media,activeSession,'Не удалось воспроизвести запись. Проверь подключение к облаку.');wrap.append(audio);b.hidden=true;audio.play().catch(()=>{});}catch(e){if(e.message!=='locked')notify(mediaError(e));}finally{b.disabled=false;}
}
async function openMedia(media,m){
 $('#menu').hidden=true;$('#viewer').hidden=false;$('#viewer-label').textContent=displayDate(m.date,true);const content=$('#viewer-content');content.replaceChildren(el('span','loading-spinner'));viewAsset=media.asset;const activeSession=sessionGeneration;
 try{
  const assetMeta=archive.media[media.asset];if(!assetMeta)throw Error('missing');const url=await (assetMeta.mime.startsWith('video/')||assetMeta.mime.startsWith('audio/')?streamingURL(media.asset):resolveAsset(media.asset));if(activeSession!==sessionGeneration||$('#viewer').hidden||viewAsset!==media.asset)return;const meta=archive.media[media.asset];content.replaceChildren();
  if(meta.mime.startsWith('image/')){const image=el('img');image.src=url;image.alt=mediaLabel(media.kind);content.append(image);}
  else if(meta.mime.startsWith('video/')){const video=el('video');video.controls=true;video.playsInline=true;video.src=url;video.autoplay=true;video.onerror=()=>playWithoutWorker(video,media,activeSession,'Не удалось воспроизвести видео. Проверь подключение к облаку.');content.append(video);}
  else if(meta.mime.startsWith('audio/')){const audio=el('audio');audio.controls=true;audio.src=url;content.append(audio);audio.play().catch(()=>{});}
  else if(meta.name.endsWith('.tgs')){const bytes=await(await fetch(url)).arrayBuffer(),json=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();if(activeSession!==sessionGeneration||viewAsset!==media.asset||$('#viewer').hidden)return;const target=el('div');target.style.width='min(85vw,400px)';target.style.height='min(85vw,400px)';content.append(target);stickerAnimation=window.lottie.loadAnimation({container:target,renderer:'svg',loop:true,autoplay:true,animationData:json});}
  else{const wrap=el('div','empty-state');wrap.append(el('p','',meta.name),button('full-button','Скачать файл',()=>downloadAsset(media.asset)));content.append(wrap);}
 }catch(e){if(e.message!=='locked'&&!$('#viewer').hidden)content.replaceChildren(el('div','empty-state',mediaError(e)));}
}
function closeViewer(){stickerAnimation?.destroy();stickerAnimation=null;$('#viewer').hidden=true;$('#viewer-content').querySelectorAll('audio,video').forEach(x=>{x.pause();x.removeAttribute('src');x.load();});$('#viewer-content').replaceChildren();viewAsset=null;}
$('#viewer-close').onclick=closeViewer;
async function downloadAsset(id){try{const url=await resolveAsset(id),a=el('a');a.href=url;a.download=archive.media[id].name;a.click();}catch(e){notify(mediaError(e));}}
$('#viewer-download').onclick=()=>viewAsset&&downloadAsset(viewAsset);
async function openGallery(){
 if(!archive)return;const content=openSheet('Общие медиа'),tabs=el('div','media-tabs'),body=el('div');let active='visual',shown=0,filtered=[],selection=0;const types=[['visual','Фото и видео'],['voice','Голосовые'],['file','Файлы'],['audio','Музыка'],['sticker','Стикеры']];
 content.append(tabs,body);if(mediaConfig?.provider==='none')content.prepend(el('p','sheet-caption','Вложения ещё не подключены к облаку. Здесь сохранён список файлов из экспорта.'));
 async function more(){const chosen=selection;body.querySelector('.load-more')?.remove();const slice=filtered.slice(shown,shown+48);shown+=slice.length;const grid=active==='visual'||active==='sticker'?el('div','media-grid'):el('div');body.append(grid);const activeSession=sessionGeneration;for(const i of slice){const m=await getMessage(i);if(activeSession!==sessionGeneration||!body.isConnected||selection!==chosen)return;const media=m.media;if(active==='visual'||active==='sticker'){const b=button('media-tile','',()=>openMedia(media,m)),thumb=media.thumb||(media.kind==='photo'?media.asset:null);b.setAttribute('aria-label',mediaLabel(media.kind)+' '+displayDate(m.date));if(thumb){const img=el('img');img.alt=mediaLabel(media.kind);img.loading='lazy';b.append(img);observeImage(img,thumb);}else b.append(icon(media.kind==='photo'?'photo':'play'));if(media.kind==='video'||media.kind==='round')b.append(el('small','',media.detail||'▶'));grid.append(b);}else{const b=button('result','',()=>{closeSheet();jump(i);});b.append(el('div','result-meta',displayDate(m.date,true)),el('div','result-text',media.title||mediaLabel(media.kind)));grid.append(b);}}if(shown<filtered.length)body.append(button('load-more','Показать ещё',more));}
 function choose(type){selection++;active=type;shown=0;body.replaceChildren();[...tabs.children].forEach(b=>b.classList.toggle('selected',b.dataset.type===type));filtered=[];for(let i=archive.messages.length-1;i>=0;i--){const kind=archive.messages[i][4];if(type==='visual'?['photo','video','round'].includes(kind):kind===type)filtered.push(i);}if(!filtered.length)body.append(el('div','empty-state','Здесь пока нет файлов'));else more().catch(()=>notify('Не удалось загрузить список медиа'));}
 for(const [type,label]of types){const b=button('',label,()=>choose(type));b.dataset.type=type;tabs.append(b);}choose(active);
}
$('#media-open').onclick=openGallery;
function openProfile(){if(!archive)return;const c=openSheet('О переписке'),hero=el('div','profile-hero'),avatar=el('span','avatar',prefs.contact[0]);hero.append(avatar,el('h3','',prefs.contact),el('p','','Наша сохранённая история'));c.append(hero);const stats=el('div','stats');for(const [number,label]of [[archive.counts.messages,'сообщений'],[archive.counts.days,'дней'],[archive.counts.assets,'вложений']]){const s=el('div');s.append(el('strong','',new Intl.NumberFormat('ru-RU').format(number)),el('small','',label));stats.append(s);}c.append(stats,el('p','sheet-caption',displayDate(archive.first,true)+' — '+displayDate(archive.last,true)),button('full-button','Фото, видео и файлы',openGallery),button('full-button','Найти сообщение',()=>{closeSheet();openSearch();}),button('full-button','Перейти к дате',()=>openCalendar()),button('full-button','Настройки',openSettings));}
$('#profile').onclick=openProfile;$('#back').onclick=openProfile;$('#conversation').onclick=()=>jump(currentIndex);
function openSettings(){
 const c=openSheet('Настройки'),group=el('div','setting-group');c.append(el('p','sheet-caption','Настройки сохраняются только на этом устройстве.'),group);
 function row(label,control){const r=el('div','setting-row'),l=el('label','',label);control.id='setting-'+group.children.length;l.htmlFor=control.id;r.append(l,control);group.append(r);}
 const theme=el('select');for(const [value,label]of [['reference','Как на скриншоте'],['auto','Как на iPhone'],['light','Светлая'],['dark','Тёмная']]){const o=el('option','',label);o.value=value;theme.append(o);}theme.value=prefs.theme;theme.onchange=()=>{prefs.theme=theme.value;storageSet('chat-theme-v2',theme.value);applyPrefs();updateScroll();};row('Оформление',theme);
 const size=el('input');size.type='checkbox';size.checked=prefs.large;size.onchange=()=>{prefs.large=size.checked;storageSet('chat-large',String(size.checked));applyPrefs();};row('Крупный текст',size);
 const name=el('input');name.type='text';name.maxLength=40;name.value=prefs.contact;name.onchange=()=>{prefs.contact=name.value.trim()||'Егор';storageSet('chat-contact',prefs.contact);applyPrefs();};row('Имя в шапке чата',name);
 const perspective=el('select');for(const [value,label]of [['1','От её лица'],['0','От его лица']]){const o=el('option','',label);o.value=value;perspective.append(o);}perspective.value=String(prefs.perspective);perspective.onchange=()=>{prefs.perspective=Number(perspective.value);storageSet('chat-perspective',perspective.value);jump(currentIndex);};row('Как читать',perspective);
 c.append(el('p','sheet-caption','Чтобы открыть как приложение: в Safari нажми «Поделиться» → «На экран Домой». Для чтения нужен интернет. Пароль не сохраняется на устройстве.'),button('full-button danger','Закрыть архив',closeArchive));
}
$$('.settings-trigger').forEach(b=>b.onclick=openSettings);$('#side-lock').onclick=closeArchive;
$('#menu-open').onclick=event=>{event.stopPropagation();$('#menu').hidden=!$('#menu').hidden;};document.addEventListener('click',event=>{if(!event.target.closest('#menu')&&!event.target.closest('#menu-open'))$('#menu').hidden=true;});
const actions={search:openSearch,calendar:openCalendar,media:openGallery,settings:openSettings,lock:closeArchive};$$('#menu [data-action]').forEach(b=>b.onclick=()=>{const action=b.dataset.action;$('#menu').hidden=true;actions[action]();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('#viewer').hidden)closeViewer();else if(!$('#sheet').hidden)closeSheet();else if(!$('#menu').hidden)$('#menu').hidden=true;else if(!$('#search-bar').hidden)closeSearch();}if((event.metaKey||event.ctrlKey)&&event.key==='f'&&archive){event.preventDefault();openSearch();}if(event.key==='Tab'){const modal=!$('#viewer').hidden?$('#viewer'):!$('#sheet').hidden?$('#sheet'):null;if(modal){const focusables=[...modal.querySelectorAll('button:not(:disabled),input,select,a[href],video[controls],audio[controls]')].filter(x=>x.offsetParent!==null);if(focusables.length){const first=focusables[0],last=focusables.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}}});
if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});navigator.serviceWorker.addEventListener('controllerchange',syncMediaSession);}
