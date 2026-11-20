import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {FastifyInstance} from 'fastify';

const contentTypes:Record<string,string>={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
 '.webmanifest':'application/manifest+json; charset=utf-8',
 '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp',
 '.ico':'image/x-icon','.woff2':'font/woff2'
};
export function registerStaticUi(app:FastifyInstance,root=process.env.LOJA_WEB_DIST){
 if(!root)return;
 const base=path.resolve(root);
 async function respond(raw:string,reply:import('fastify').FastifyReply){
  const pathname=new URL(raw,'http://localhost').pathname;
  let requested;
  try{requested=decodeURIComponent(pathname);}catch{return reply.code(400).send('Caminho inválido');}
  if(requested.startsWith('/v1/')||requested.includes('\\')||requested.includes('\0'))
   return reply.code(404).send('Não encontrado');
  const relative=requested.slice(1)||'index.html';
  const file=path.resolve(base,relative);
  if(file!==path.join(base,'index.html')&&!file.startsWith(base+path.sep))
   return reply.code(404).send('Não encontrado');
  let content:Buffer;
  try{content=await readFile(file);}
  catch{
   if(path.extname(relative))return reply.code(404).send('Recurso inexistente');
   content=await readFile(path.join(base,'index.html'));
   reply.header('cache-control','no-store');
   return reply.type('text/html; charset=utf-8').send(content);
  }
  if(relative==='index.html'||relative==='service-worker.js')reply.header('cache-control','no-store');
  else reply.header('cache-control','public, max-age=3600');
  return reply.type(contentTypes[path.extname(relative)]||'application/octet-stream').send(content);
 }
 app.get('/',async(request,reply)=>respond(request.url,reply));
 app.get('/*',async(request,reply)=>respond(request.url,reply));
}
