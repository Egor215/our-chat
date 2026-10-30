/** Optional Cloudflare Worker when Yandex downloads cannot be fetched by Safari directly.
 * Env: YANDEX_PUBLIC_URL = public encrypted media folder URL
 *      ALLOWED_ORIGIN = exact GitHub Pages origin, e.g. https://username.github.io
 * This proxy only transports encrypted parts. It never receives the archive password.
 */
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN;
  const cors={'Access-Control-Allow-Origin':allowed||'null','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'public,max-age=3600'};
  if(!allowed||origin!==allowed)return new Response('Forbidden',{status:403});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:cors});
  const path=new URL(request.url).searchParams.get('path');
  if(!/^[a-f0-9]{2}\/[a-f0-9]{32}\.\d{3}\.bin$/.test(path||''))return new Response('Invalid file',{status:400,headers:cors});
  if(!env.YANDEX_PUBLIC_URL)return new Response('Storage not configured',{status:503,headers:cors});
  try{
   const query=new URLSearchParams({public_key:env.YANDEX_PUBLIC_URL,path:'/'+path});
   const response=await fetch('https://cloud-api.yandex.net/v1/disk/public/resources/download?'+query,{redirect:'error'});
   if(!response.ok)return new Response('Storage unavailable',{status:502,headers:cors});
   const href=new URL((await response.json()).href);
   if(href.protocol!=='https:'||!['yandex.ru','yandex.net','yandex.com'].some(domain=>href.hostname===domain||href.hostname.endsWith('.'+domain)))return new Response('Invalid download host',{status:502,headers:cors});
   const download=await fetch(href,{redirect:'follow'});
   if(!download.ok)return new Response('File unavailable',{status:502,headers:cors});
   return new Response(download.body,{headers:{...cors,'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Storage unavailable',{status:502,headers:cors});}
 }
};
