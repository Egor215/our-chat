/** Optional Cloudflare Worker when Google Drive downloads cannot be fetched by Safari directly.
 * Env: DRIVE_FOLDER_ID = id of the uploaded encrypted media folder
 *      DRIVE_API_KEY = Google API key with the Drive API enabled
 *      ALLOWED_ORIGIN = exact GitHub Pages origin, e.g. https://username.github.io
 * This proxy only transports encrypted parts. It never receives the archive password.
 */
const listings=new Map();
function children(parent,key){
 if(!listings.has(parent))listings.set(parent,(async()=>{
  const files=new Map();let token='';
  do{
   const query=new URLSearchParams({q:"'"+parent+"' in parents and trashed=false",key,fields:'files(id,name),nextPageToken',pageSize:'1000'});
   if(token)query.set('pageToken',token);
   const response=await fetch('https://www.googleapis.com/drive/v3/files?'+query);
   if(!response.ok)throw Error('listing');
   const data=await response.json();
   for(const file of data.files||[])files.set(file.name,file.id);
   token=data.nextPageToken||'';
  }while(token);
  return files;
 })().catch(error=>{listings.delete(parent);throw error;}));
 return listings.get(parent);
}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN;
  const cors={'Access-Control-Allow-Origin':allowed||'null','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'public,max-age=3600'};
  if(!allowed||origin!==allowed)return new Response('Forbidden',{status:403});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:cors});
  const path=new URL(request.url).searchParams.get('path');
  if(!/^[a-f0-9]{2}\/[a-f0-9]{32}\.\d{3}\.bin$/.test(path||''))return new Response('Invalid file',{status:400,headers:cors});
  if(!env.DRIVE_FOLDER_ID||!env.DRIVE_API_KEY)return new Response('Storage not configured',{status:503,headers:cors});
  try{
   const parent=(await children(env.DRIVE_FOLDER_ID,env.DRIVE_API_KEY)).get(path.slice(0,2));
   if(!parent)return new Response('File unavailable',{status:404,headers:cors});
   const id=(await children(parent,env.DRIVE_API_KEY)).get(path.slice(3));
   if(!id)return new Response('File unavailable',{status:404,headers:cors});
   const download=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media&key='+encodeURIComponent(env.DRIVE_API_KEY));
   if(!download.ok)return new Response('Storage unavailable',{status:502,headers:cors});
   return new Response(download.body,{headers:{...cors,'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Storage unavailable',{status:502,headers:cors});}
 }
};
