"""Import Telegram HTML without modifying the export. Encrypt before publication."""
from pathlib import Path
from lxml import html, etree
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
import argparse, base64, collections, concurrent.futures, datetime, gzip, hashlib, json, mimetypes, os, re, secrets, shutil, subprocess
from urllib.parse import unquote, urlparse
from html import escape

ROOT = Path(__file__).resolve().parents[1]
ITERATIONS = 600000
PART_BYTES = 8 * 1024 * 1024

def compact(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')

def text(node):
    if node is None: return ''
    clone = html.fromstring(html.tostring(node))
    for br in clone.xpath('.//br'): br.tail = '\n' + (br.tail or '')
    return clone.text_content().strip()

def cls(node, name):
    return node.xpath('./*[contains(concat(" ", normalize-space(@class), " "), " '+name+' ")]')

def first(node, name):
    v = cls(node, name)
    return v[0] if v else None

def safe_html(node):
    if node is None: return ''
    allowed = {'a','b','strong','i','em','u','s','del','code','pre','br','span','blockquote'}
    clone = html.fromstring(html.tostring(node))
    for el in list(clone.iterdescendants()):
        if not isinstance(el.tag,str): continue
        if el.tag not in allowed:
            el.drop_tag(); continue
        href = el.get('href') if el.tag == 'a' else None
        el.attrib.clear()
        if href and urlparse(href).scheme in {'https','http','mailto','tel','tg'}:
            el.set('href',href);el.set('target','_blank');el.set('rel','noopener noreferrer')
    return (escape(clone.text or '') + ''.join(etree.tostring(c,encoding='unicode',method='html') for c in clone)).strip()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('export',type=Path)
    ap.add_argument('--media',action='store_true',help='Prepare encrypted media folder for cloud upload')
    args=ap.parse_args()
    src=args.export.resolve(); private=ROOT/'private';private.mkdir(exist_ok=True)
    keyfile=private/'access.json'
    if keyfile.exists(): auth=json.loads(keyfile.read_text('utf-8'))
    else:
        auth={'password':secrets.token_urlsafe(20),'salt':base64.b64encode(os.urandom(16)).decode()}
        keyfile.write_text(json.dumps(auth,indent=2),encoding='utf-8')
        (private/'ПАРОЛЬ.txt').write_text('Пароль от архива:\n'+auth['password']+'\n\nНе загружайте папку private на GitHub или Диск.\n',encoding='utf-8')
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=base64.b64decode(auth['salt']),iterations=ITERATIONS).derive(auth['password'].encode())
    aes=AESGCM(key)
    dist=ROOT/'docs';dist.mkdir(exist_ok=True)
    for f in (ROOT/'web').iterdir():
        if f.is_file():shutil.copy2(f,dist/f.name)
    datadir=dist/'data';datadir.mkdir(exist_ok=True)
    def encrypt(payload):
        iv=os.urandom(12)
        return iv+aes.encrypt(iv,payload,None)
    def encrypted_json(path,obj):path.write_bytes(encrypt(gzip.compress(compact(obj),mtime=0)))
    media={}; missing=[]
    def asset(ref):
        if not ref:return None
        rel=unquote(ref).replace('\\','/')
        actual=(src/rel).resolve()
        if not actual.is_relative_to(src) or not actual.is_file():
            missing.append(rel);return None
        ident=hashlib.sha256(rel.encode()).hexdigest()[:32]
        if ident not in media:
            mime=mimetypes.guess_type(rel)[0] or 'application/octet-stream'
            media[ident]={'path':rel,'name':actual.name,'mime':mime,'size':actual.stat().st_size,'parts':[]}
        return ident
    pages=sorted(src.glob('messages*.html'),key=lambda p:0 if p.stem=='messages' else int(p.stem[8:]))
    messages=[]; sender=0
    for page in pages:
        tree=html.parse(str(page))
        for m in tree.xpath('//div[starts-with(@class,"message ")]'):
            ident=m.get('id','')
            if not ident.startswith('message'):continue
            body=first(m,'body')
            if body is None:continue
            if 'default' not in m.get('class',''):
                service=text(body)
                if re.fullmatch(r'\d{1,2} [A-Z][a-z]+ \d{4}',service):continue
                if not messages:continue
            else:service=None
            stamp=first(body,'date')
            if stamp is None:
                if not service:continue
                iso=messages[-1]['date'] # Telegram exports no exact timestamp for these service events.
            else:
                date=stamp.get('title','')
                match=re.match(r'(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}:\d{2}) GMT([+-]\d{2}:\d{2})',date)
                if not match:raise ValueError('Unknown export date format')
                day,month,year,clock,tz=match.groups(); iso=f'{year}-{month}-{day}T{clock}{tz}'
            who=first(body,'from_name')
            if who is not None:
                sender=1 if text(who).startswith('Deleted Account') else 0
            content=first(body,'text')
            record={'id':int(ident[7:]),'date':iso,'day':iso[:10],'sender':sender,'text':text(content),'html':safe_html(content)}
            if service:record.update(service=True,text=service)
            reply=first(body,'reply_to')
            if reply is not None:
                a=reply.xpath('.//a/@href')
                if a:
                    r=re.search(r'message(-?\d+)',a[0])
                    if r:record['reply']=int(r.group(1))
            forwarded=first(body,'forwarded')
            if forwarded is not None:
                name=first(forwarded,'from_name')
                record['forwarded']=text(name).split('\n')[0] if name is not None else 'Пересланное сообщение'
                inner=first(forwarded,'text')
                if inner is not None and content is None:record.update(text=text(inner),html=safe_html(inner))
            wrap=first(body,'media_wrap')
            if wrap is not None:
                links=wrap.xpath('.//a[@href]')
                a=links[0] if links else (wrap[0] if len(wrap) else wrap)
                href=a.get('href',''); c=a.get('class','');rel=unquote(href)
                kind=('sticker' if rel.startswith('stickers/') else 'call' if 'media_call' in c else 'contact' if 'media_contact' in c else 'photo' if 'photo_wrap' in c or 'media_photo' in c else 'round' if rel.startswith('round_video_messages/') else 'voice' if 'voice_message' in c else 'video' if 'video_file' in c or 'animated_wrap' in c or 'media_video' in c else 'audio' if 'audio_file' in c else 'file')
                img=a.xpath('.//img/@src');title=a.xpath('.//div[contains(@class,"title")]');status=a.xpath('.//div[contains(@class,"status") or contains(@class,"video_duration")]')
                record['media']={'kind':kind,'asset':asset(href),'thumb':asset(img[0]) if img else None,'title':text(title[0]) if title else '', 'detail':text(status[0]) if status else '', 'animated':'animated_wrap' in c}
                if record['media']['asset'] is None:record['media']['missing']=True
            reactions=first(body,'reactions')
            if reactions is not None:
                record['reactions']=[text(n) for n in reactions.xpath('.//span[contains(concat(" ",normalize-space(@class)," ")," emoji ")]')]
            messages.append(record)
    ids=[m['id'] for m in messages]
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate message IDs')
    if any(messages[i]['date']>messages[i+1]['date'] for i in range(len(messages)-1)):raise ValueError('Export is not chronological')
    index=[];days={};chunks=[]
    for i,m in enumerate(messages):
        days.setdefault(m['day'],i)
        index.append([m['id'],m['date'],m['sender'],m['text'],m.get('media',{}).get('kind',''),m.get('service',False)])
    for start in range(0,len(messages),400):
        name=f'{start//400:04}.bin';part=messages[start:start+400]
        encrypted_json(datadir/name,part);chunks.append(name)
    # Convert Opus to AAC for iPhones that cannot play the export's Ogg files.
    out=ROOT/'media-upload';out.mkdir(exist_ok=True)
    conversion=private/'converted';conversion.mkdir(exist_ok=True)
    def prepare_asset(item):
        ident,meta=item; original=src/meta['path'];actual=original
        if meta['path'].endswith('.ogg') and args.media:
            target=conversion/(ident+'.m4a')
            if not target.exists():
                subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(original),'-c:a','aac','-b:a','64k',str(target)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            actual=target;meta['mime']='audio/mp4';meta['name']=original.stem+'.m4a';meta['size']=actual.stat().st_size
        n=(actual.stat().st_size+PART_BYTES-1)//PART_BYTES
        meta['parts']=[f'{ident[:2]}/{ident}.{i:03}.bin' for i in range(n)]
        if args.media:
            with actual.open('rb') as stream:
                for name in meta['parts']:
                    payload=stream.read(PART_BYTES);target=out/name;target.parent.mkdir(exist_ok=True)
                    if not target.exists():target.write_bytes(encrypt(payload))
        meta.pop('path',None)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(prepare_asset,media.items()))
    archive={'version':1,'contact':'Егор','owner':'Ты','messages':index,'chunks':chunks,'chunkSize':400,'days':days,'media':media,'counts':{'messages':sum(not m.get('service') for m in messages),'events':len(messages),'assets':len(media),'days':len(days)},'first':messages[0]['day'],'last':messages[-1]['day']}
    encrypted_json(datadir/'index.bin',archive)
    (dist/'archive.json').write_text(json.dumps({'version':1,'salt':auth['salt'],'iterations':ITERATIONS,'index':'data/index.bin'},indent=2),encoding='utf-8')
    config=dist/'media-config.json'
    if not config.exists():config.write_text(json.dumps({'provider':'none','baseUrl':'','yandexPublicUrl':'','proxyUrl':''},indent=2),encoding='utf-8')
    (dist/'.nojekyll').touch()
    report={'pages':len(pages),'messages':archive['counts']['messages'],'events':len(messages),'assets':len(media),'days':len(days),'first':archive['first'],'last':archive['last'],'missingAssetReferences':len(set(missing)),'unavailableMediaMessages':sum(bool(m.get('media',{}).get('missing')) and m['media']['kind'] not in {'call','contact'} for m in messages),'mediaPrepared':args.media,'websiteMB':round(sum(p.stat().st_size for p in dist.rglob('*') if p.is_file())/1024**2,2),'mediaGB':round(sum(p.stat().st_size for p in out.rglob('*') if p.is_file())/1024**3,2)}
    (private/'import-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
