"""Fail closed before uploading any GitHub Pages artifact."""
from pathlib import Path
import json, subprocess

root=Path(__file__).resolve().parents[1]
dist=root/'docs'
for required in ['index.html','app.js','archive.json','data/index.bin']:
    assert (dist/required).is_file(),f'Missing {required}'
paths=[p for p in dist.rglob('*') if p.is_file()]
assert sum(p.stat().st_size for p in paths)<950*1024**2,'Pages artifact is too large'
allowed={'.html','.js','.css','.svg','.png','.json','.bin','.webmanifest','.md',''}
for path in paths:
    rel=path.relative_to(dist)
    assert not any(p in {'private','media-upload','photos','voice_messages','video_files','round_video_messages'} for p in rel.parts),f'Raw media path: {rel}'
    assert path.suffix in allowed,f'Unexpected file type: {rel}'
    assert not path.name.startswith('messages'),f'Raw Telegram export: {rel}'
    if path.suffix=='.bin':
        assert path.stat().st_size>28,'Invalid ciphertext'
    elif path.suffix in {'.json','.html','.js'}:
        data=path.read_text('utf-8')
        assert 'BEGIN PRIVATE KEY' not in data,'Private key in artifact'
        assert not ('"password":' in data or '"password" :' in data),'Password in artifact'
private=root/'private/access.json'
if private.exists():
    password=json.loads(private.read_text('utf-8'))['password'].encode()
    assert all(password not in p.read_bytes() for p in paths),'Password leaked into published files'
try:
    tracked=subprocess.check_output(['git','ls-files'],cwd=root,text=True,stderr=subprocess.DEVNULL).splitlines()
    assert not any(p.startswith(('private/','media-upload/')) for p in tracked),'Private files tracked by Git'
except subprocess.CalledProcessError:pass
print(f'Publication verified: {len(paths)} files, encrypted archive, no raw export or password.')
