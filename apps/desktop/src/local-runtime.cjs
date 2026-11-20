'use strict';
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {existsSync} = require('node:fs');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const expectedBinaries=resources=>['initdb.exe','pg_ctl.exe','psql.exe','createdb.exe'].map(name=>path.join(resources,'runtime','postgres','bin',name));
function makeDatabaseUrl(password,port){
 const url=new URL('postgresql://postgres@127.0.0.1:'+port+'/loja');
 url.password=password;
 return url.href;
}
function validateBootstrap(raw){
 const name=String(raw?.name||'').trim(),login=String(raw?.login||'').trim().toLowerCase();
 const password=String(raw?.password||'');
 if(!name||name.length>120||!login||login.length>80||!/^[a-z0-9_.@-]+$/.test(login))
  throw new Error('Informe nome da loja e login válido (letras, números, ponto, hífen ou sublinhado).');
 if(password.length<12||password.length>256)throw new Error('A senha precisa ter entre 12 e 256 caracteres.');
 return {name,login,password};
}
async function freePort(){
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const addr=server.address(),port=typeof addr==='object'&&addr?addr.port:0;
   server.close(error=>error?reject(error):resolve(port));
  });
 });
}
async function execute(binary,args,options={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd:options.cwd,env:options.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',data=>{stdout+=data.toString();stdout=stdout.slice(-20000);});
  child.stderr.on('data',data=>{stderr+=data.toString();stderr=stderr.slice(-20000);});
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?resolve(stdout.trim()):reject(new Error(
   'Falha no serviço local ('+path.basename(binary)+', '+(signal||code)+'): '+stderr.slice(-1000)
  )));
 });
}
async function savePrivate(file,value){
 const temp=file+'.tmp-'+randomBytes(5).toString('hex');
 try{await fs.writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await fs.rename(temp,file);}
 finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
async function ready(url,child){
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw new Error('A API local encerrou antes de ficar disponível.');
  try{
   const result=await fetch(url+'/v1/ready',{signal:AbortSignal.timeout(500)});
   if(result.ok)return;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 throw new Error('API local indisponível. Confira o antivírus e as portas locais.');
}
async function launchLocalRuntime({resources,userData,exe,progress=()=>{}}){
 if(process.platform!=='win32')throw new Error('Instalação local autônoma disponível atualmente para Windows x64.');
 const binaries=expectedBinaries(resources);
 for(const binary of binaries)if(!existsSync(binary))throw new Error('Instalador incompleto: falta '+path.basename(binary));
 const apiRoot=path.join(resources,'runtime','api');
 const webRoot=path.join(resources,'runtime','web');
 if(!existsSync(path.join(apiRoot,'src','main.ts'))||!existsSync(path.join(webRoot,'index.html')))
  throw new Error('Instalador incompleto: API ou interface não incluída.');
 await fs.mkdir(userData,{recursive:true,mode:0o700});
 const configFile=path.join(userData,'local-runtime.json'),data=path.join(userData,'postgres-data');
 let config;
 if(existsSync(configFile)){
  config=JSON.parse(await fs.readFile(configFile,'utf8'));
  if(!Number.isInteger(config.pgPort)||!Number.isInteger(config.apiPort)||!config.password||config.pgPort===config.apiPort)
   throw new Error('Configuração local inválida. Não altere ou apague os dados existentes.');
 }else{
  if(existsSync(path.join(data,'PG_VERSION')))
   throw new Error('Existe uma base sem configuração. Preserve os arquivos e restaure a configuração a partir do backup.');
  config={version:1,pgPort:await freePort(),apiPort:await freePort(),password:randomBytes(32).toString('hex')};
  while(config.pgPort===config.apiPort)config.apiPort=await freePort();
  await savePrivate(configFile,config);
 }
 const bin=name=>path.join(resources,'runtime','postgres','bin',name+'.exe');
 const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(config.pgPort),PGUSER:'postgres',PGPASSWORD:config.password};
 let apiChild=null,startedPostgres=false;
 const databaseUrl=makeDatabaseUrl(config.password,config.pgPort);
 const appEnv={...env,DATABASE_URL:databaseUrl,HOST:'127.0.0.1',PORT:String(config.apiPort),
  LOJA_WEB_DIST:webRoot,ELECTRON_RUN_AS_NODE:'1'};
 const node=async(entry,extra={})=>execute(exe,['--import','tsx',path.join(apiRoot,'src',entry)],{cwd:apiRoot,env:{...appEnv,...extra}});
 const stop=async()=>{
  if(apiChild){apiChild.kill();apiChild=null;}
  if(startedPostgres){
   await execute(bin('pg_ctl'),['-D',data,'-m','fast','-w','stop'],{env}).catch(()=>{});
   startedPostgres=false;
  }
 };
 try{
  if(!existsSync(path.join(data,'PG_VERSION'))){
   progress('Preparando o banco de dados local…');
   await fs.mkdir(data,{recursive:true,mode:0o700});
   const present=await fs.readdir(data);
   if(present.length)throw new Error('Diretório PostgreSQL contém arquivos incompletos; não foi apagado para proteger os dados.');
   const secretFile=path.join(userData,'pg-password.tmp');
   try{
    await fs.writeFile(secretFile,config.password+'\n',{mode:0o600});
    await execute(bin('initdb'),['-D',data,'-U','postgres','--encoding=UTF8','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile='+secretFile,'--no-instructions'],{env});
   }finally{await fs.rm(secretFile,{force:true});}
  }
  progress('Iniciando PostgreSQL…');
  try{await execute(bin('pg_ctl'),['-D',data,'status'],{env});}
  catch{
   await execute(bin('pg_ctl'),['-D',data,'-l',path.join(userData,'postgres.log'),
    '-o','-h 127.0.0.1 -p '+config.pgPort,'-w','-t','35','start'],{env});
   startedPostgres=true;
  }
  progress('Preparando banco e tabelas…');
  const exists=await execute(bin('psql'),['-d','postgres','-At','-c',"SELECT 1 FROM pg_database WHERE datname='loja'"],{env});
  if(exists.trim()!=='1')await execute(bin('createdb'),['loja'],{env});
  await node('migrate.ts');
  const hasUsers=(await execute(bin('psql'),['-d','loja','-At','-c','SELECT EXISTS(SELECT 1 FROM users)'],{env})).trim()==='t';
  progress('Iniciando o aplicativo…');
  // Preserve diagnostic stderr only on startup failure. Never log DATABASE_URL or credentials.
  let apiDiagnostic='';
  apiChild=spawn(exe,['--import','tsx',path.join(apiRoot,'src','main.ts')],{
   cwd:apiRoot,env:appEnv,windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  const capture=data=>{apiDiagnostic=(apiDiagnostic+String(data)).slice(-12000);};
  apiChild.stderr.on('data',capture);
  apiChild.stdout.on('data',capture);
  apiChild.on('error',error=>capture('Erro ao iniciar a API: '+error.message));
  const url='http://127.0.0.1:'+config.apiPort;
  try{
   await ready(url,apiChild);
  }catch(error){
   const diagnostic=apiDiagnostic
     .replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[DATABASE_URL redacted]')
     .split(/\r?\n/).filter(line=>/error|cannot find|ERR_|failed/i.test(line)).slice(0,4)
     .join(' ').slice(0,1200);
   throw new Error('API local não iniciou: '+(diagnostic||error.message));
  }
  return {
   url,firstRun:!hasUsers,stop,
   async bootstrap(input){
    if((await execute(bin('psql'),['-d','loja','-At','-c','SELECT EXISTS(SELECT 1 FROM users)'],{env})).trim()!=='f')
     throw new Error('A loja já tem administrador. Entre com sua conta.');
    const item=validateBootstrap(input);
    await node('bootstrap.ts',{BOOTSTRAP_STORE:item.name,BOOTSTRAP_ADMIN_LOGIN:item.login,BOOTSTRAP_ADMIN_PASSWORD:item.password});
    return {ok:true};
   }
  };
 }catch(error){await stop();throw error;}
}
module.exports={launchLocalRuntime,makeDatabaseUrl,validateBootstrap,expectedBinaries};
