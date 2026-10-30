"""Verify source message preservation and authenticated encryption, without printing chat text."""
from pathlib import Path
from lxml import html
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.exceptions import InvalidTag
import collections,gzip,json,sys
from base64 import b64decode

root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]).resolve()
auth=json.loads((root/'private/access.json').read_text('utf-8'))
config=json.loads((root/'docs/archive.json').read_text('utf-8'))
key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=b64decode(config['salt']),iterations=config['iterations']).derive(auth['password'].encode())
aes=AESGCM(key)
def decrypt(path):
    b=path.read_bytes();return aes.decrypt(b[:12],b[12:],None)
def read(path):return json.loads(gzip.decompress(decrypt(path)))
archive=read(root/'docs/data/index.bin')
all_messages=[]
for name in archive['chunks']:all_messages+=read(root/'docs/data'/name)
assert len(all_messages)==len(archive['messages'])
assert [m['id'] for m in all_messages]==[m[0] for m in archive['messages']]
original_ids=set()
for page in source.glob('messages*.html'):
    for m in html.parse(str(page)).xpath('//div[contains(concat(" ",normalize-space(@class)," ")," default ") and starts-with(@id,"message")]'):
        original_ids.add(int(m.get('id')[7:]))
imported_ids={m['id'] for m in all_messages if not m.get('service')}
assert imported_ids==original_ids,'Source messages were lost or added'
assert all(all_messages[i]['date']<=all_messages[i+1]['date'] for i in range(len(all_messages)-1))
assert len(imported_ids)==archive['counts']['messages']
assert all(m['day'] in archive['days'] for m in all_messages)
for m in all_messages:
    if m.get('html'):
        tree=html.fragment_fromstring(m['html'],create_parent='div')
        for node in tree.iterdescendants():
            assert node.tag in {'a','b','strong','i','em','u','s','del','code','pre','br','span','blockquote'}
            assert all(k in {'href','target','rel'} for k in node.attrib)
            if node.get('href'):assert node.get('href').startswith(('https:','http:','mailto:','tel:','tg:'))
types={};part_count=0
for ident,meta in archive['media'].items():
    total=0
    for part in meta['parts']:
        p=root/'media-upload'/part
        assert p.is_file(),f'Missing encrypted media part {part}'
        total+=p.stat().st_size-28;part_count+=1
    assert total==meta['size'],'Encrypted media size mismatch'
    types.setdefault(meta['mime'],meta)
for meta in types.values():
    for part in {meta['parts'][0],meta['parts'][-1]}:decrypt(root/'media-upload'/part)
b=bytearray((root/'docs/data/index.bin').read_bytes());b[-1]^=1
try:aes.decrypt(bytes(b[:12]),bytes(b[12:]),None);raise AssertionError('Tampered ciphertext accepted')
except InvalidTag:pass
print(json.dumps({'sourceMessagesPreserved':len(imported_ids),'serviceEvents':len(all_messages)-len(imported_ids),'days':len(archive['days']),'encryptedMediaAssets':len(archive['media']),'encryptedParts':part_count,'mediaTypesDecrypted':len(types),'tamperRejected':True,'messageKinds':dict(collections.Counter(m.get('media',{}).get('kind','text') for m in all_messages))},ensure_ascii=False))
