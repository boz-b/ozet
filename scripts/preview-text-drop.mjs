import http from 'node:http';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {handleTextDrop} from '../lib/text-drop.mjs';
import {MemoryBlob} from '../tests/memory-blob.mjs';

// Local verification uses synthetic texts in memory; it never calls Vercel.
const origin = 'http://127.0.0.1:8788';
const root = fileURLToPath(new URL('../public/',import.meta.url));
const storage = new MemoryBlob(origin);
const env = {TEXT_DROP_ACCESS_HASH:createHash('sha256').update('preview-code').digest('hex')};
const settings = JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'application/javascript; charset=utf-8'};
http.createServer(async (incoming,outgoing) => {
  try {
    const url = new URL(incoming.url,origin);
    const request = new Request(url,{method:incoming.method,headers:incoming.headers,
      ...(['GET','HEAD'].includes(incoming.method) ? {} : {body:Readable.toWeb(incoming),duplex:'half'})});
    let response;
    if (url.pathname === '/api/text-drop') response = await handleTextDrop(request,env,()=>storage);
    else if (url.pathname.startsWith('/_test-upload/') && request.method === 'PUT') {
      await storage.upload(url,request.body,request.headers.get('content-type'));
      response = Response.json({saved:true});
    } else if (url.pathname === '/favicon.ico') response = new Response(null,{status:204});
    else if (['GET','HEAD'].includes(request.method) &&
      (['/','/index.html','/text-drop.html'].includes(url.pathname) || /^\/(assets|pages)\/[a-z0-9-]+\.(css|js|html)$/.test(url.pathname))) {
      const path = url.pathname === '/' ? '/text-drop.html' : url.pathname;
      const bytes = await readFile(join(root,path));
      const pageHeaders = path === '/text-drop.html' ? Object.fromEntries(settings.headers[0].headers.map(({key,value})=>[key,value])) : {};
      response = new Response(request.method === 'HEAD' ? null : bytes,{headers:{...pageHeaders,'content-type':types[path.split('.').pop()]}});
    } else response = new Response('Not found',{status:404});
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
  } catch { outgoing.writeHead(503,{'content-type':'text/plain'}); outgoing.end('Preview could not complete the request.'); }
}).listen(8788,'127.0.0.1',()=>console.log('Text Drop preview: '+origin+'/text-drop.html — test-only access code: preview-code'));
