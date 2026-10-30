"""Loopback preview including the encrypted media; cloud settings stay unchanged."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote,urlparse
import argparse,json
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'docs'),**kw)
    def do_GET(self):
        if urlparse(self.path).path=='/media-config.json':
            payload=json.dumps({'provider':'http','baseUrl':f'http://127.0.0.1:{self.server.server_port}/__media__/'}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
        super().do_GET()
    def translate_path(self,path):
        path=unquote(urlparse(path).path)
        if path.startswith('/__media__/'):
            target=(ROOT/'media-upload'/path[len('/__media__/'):]).resolve()
            if target.is_relative_to((ROOT/'media-upload').resolve()):return str(target)
            return str(ROOT/'private-nonexistent')
        return super().translate_path(path)
    def log_message(self,*args):pass
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=8766);args=ap.parse_args()
    print(f'Local: http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
