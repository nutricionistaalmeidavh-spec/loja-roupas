'use strict';
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {existsSync} = require('node:fs');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const {writeBackup,isPgDumpArchive,runAutoBackup,backupFilename}=require('./local-backup.cjs');

const expectedBinaries=resources=>['initdb.exe','pg_ctl.exe','psql.exe','createdb.exe','postgres.exe','pg_dump.exe','pg_restore.exe','dropdb.exe'].map(name=>path.join(resources,'runtime','postgres','bin',name));
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
  const child=spawn(binary,args,{cwd:options.cwd,env:options.env,windowsHide:true,stdio:[options.input===undefined?'ignore':'pipe','pipe','pipe']});
  if(options.input!==undefined){
   child.stdin.on('error',()=>{/* Child startup errors are reported by exit/error below. */});
   child.stdin.end(options.input);
  }
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
async function launchLocalRuntime({resources,userData,exe,physicalEdition=false,progress=()=>{},log=null}){
 if(process.platform!=='win32')throw new Error('Instalação local autônoma disponível atualmente para Windows x64.');
 const binaries=expectedBinaries(resources);
 for(const binary of binaries)if(!existsSync(binary))throw new Error('Instalador incompleto: falta '+path.basename(binary));
 for(const folder of ['lib','share'])if(!existsSync(path.join(resources,'runtime','postgres',folder)))
  throw new Error('Instalador incompleto: faltam bibliotecas PostgreSQL ('+folder+').');
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
  LOJA_WEB_DIST:webRoot,LOJA_SYNC_SECRET_DIR:path.join(userData,'sync-secrets'),
  LOJA_EDITION:physicalEdition?'physical':'full',ELECTRON_RUN_AS_NODE:'1'};
 const node=async(entry,extra={},input)=>execute(exe,['--import','tsx',path.join(apiRoot,'src',entry)],{cwd:apiRoot,env:{...appEnv,...extra},input});
 const stop=async()=>{
  if(apiChild){apiChild.kill();apiChild=null;}
  if(startedPostgres){
   await execute(bin('pg_ctl'),['-D',data,'-m','fast','-w','stop'],{env}).catch(()=>{});
   startedPostgres=false;
  }
 };
 try{
  // A presença de initdb.exe não comprova a presença de suas DLLs no Windows.
  // Executar antes de criar ou alterar qualquer arquivo da base preserva dados.
  try{await execute(bin('initdb'),['--version'],{env});}
  catch(error){
   const message=String(error?.message||error);
   if(message.includes('3221225781')||message.includes('-1073741515')||message.includes('0xC0000135'))
    throw new Error('PostgreSQL não iniciou: falta uma DLL do Windows (0xC0000135). Instale o Microsoft Visual C++ Redistributable x64 incluído no instalador e tente novamente. Seus dados foram preservados.');
   throw new Error('Não foi possível executar o PostgreSQL incluído: '+message);
  }
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
  const capture=data=>{apiDiagnostic=(apiDiagnostic+String(data)).slice(-12000);log?.write('api',String(data));};
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
   async verifyBackup(source){
    if(!await isPgDumpArchive(source))throw new Error('Selecione um arquivo .dump PostgreSQL válido.');
    const restored='loja_restore_'+randomBytes(6).toString('hex');
    await execute(bin('createdb'),[restored],{env});
    try{
     await execute(bin('pg_restore'),['--exit-on-error','--no-owner','--no-privileges','--dbname',restored,source],{env});
     const out=await execute(bin('psql'),['-d',restored,'-At','-F','|','-c',
      'SELECT (SELECT count(*) FROM sales),(SELECT count(*) FROM product_photos),(SELECT count(*) FROM schema_migrations)'],{env});
     const parts=out.trim().split('|').map(Number);
     if(parts.length!==3||parts.some(v=>!Number.isSafeInteger(v)||v<0))
      throw new Error('Restaurado, mas as tabelas essenciais não puderam ser verificadas.');
     return {verified:true,sales:parts[0],photos:parts[1],migrations:parts[2]};
    }finally{await execute(bin('dropdb'),['--if-exists',restored],{env}).catch(()=>{});}
   },
   async autoBackup(folder,force=false){
    return runAutoBackup({folder,userData,force,executeDump:file=>
      execute(bin('pg_dump'),['--format=custom','--no-owner','--file',file,'--dbname','loja'],{env})});
   },
   /**
    * Restaura um backup sobre a base da loja. Antes de trocar: confere o arquivo numa base temporária
    * e grava uma cópia de segurança da base atual. A base anterior fica guardada com outro nome.
    * Depois de restaurar, o aplicativo precisa ser reiniciado.
    */
   async restoreBackup(source){
    if(!await isPgDumpArchive(source))throw new Error('Selecione um arquivo .dump PostgreSQL válido.');
    const stamp=Date.now().toString(36);
    const restored='loja_restore_'+stamp;
    await execute(bin('createdb'),[restored],{env});
    let swapped=false;
    try{
     await execute(bin('pg_restore'),['--exit-on-error','--no-owner','--no-privileges','--dbname',restored,source],{env});
     const check=await execute(bin('psql'),['-d',restored,'-At','-c','SELECT count(*) FROM schema_migrations'],{env});
     if(!Number.isSafeInteger(Number(check.trim())))throw new Error('O arquivo não parece um backup desta loja.');
     const safety=path.join(userData,'backups','antes-da-restauracao-'+backupFilename().slice('loja-'.length));
     await writeBackup({destination:safety,userData,executeDump:file=>
      execute(bin('pg_dump'),['--format=custom','--no-owner','--file',file,'--dbname','loja'],{env})});
     if(apiChild){apiChild.kill();apiChild=null;}
     const previous='loja_anterior_'+stamp;
     await execute(bin('psql'),['-d','postgres','-v','ON_ERROR_STOP=1','-c',
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='loja' AND pid<>pg_backend_pid();",
      '-c','ALTER DATABASE loja RENAME TO '+previous+';','-c','ALTER DATABASE '+restored+' RENAME TO loja;'],{env});
     swapped=true;
     // Mantém só a base anterior mais recente, para não encher o disco.
     const old=await execute(bin('psql'),['-d','postgres','-At','-c',
      "SELECT datname FROM pg_database WHERE datname LIKE 'loja\\_anterior\\_%' AND datname<>'"+previous+"'"],{env});
     for(const name of old.split(/\r?\n/).map(x=>x.trim()).filter(x=>/^loja_anterior_[a-z0-9]+$/.test(x)))
      await execute(bin('dropdb'),['--if-exists',name],{env}).catch(()=>{});
     return {restored:true,safety_backup:safety,previous_database:previous};
    }finally{
     if(!swapped)await execute(bin('dropdb'),['--if-exists',restored],{env}).catch(()=>{});
    }
   },
   async backup(destination){
    return writeBackup({destination,userData,executeDump:file=>
      execute(bin('pg_dump'),['--format=custom','--no-owner','--file',file,'--dbname','loja'],{env})});
   },
   async resetAdminPassword(input){
    const login=String(input?.login??'').trim().toLowerCase();
    const password=input?.password;
    if(!/^[a-z0-9_.@-]{1,80}$/.test(login)||typeof password!=='string'||password.length<12||password.length>256)
     throw new Error('Informe o usuário administrador e uma nova senha de 12 a 256 caracteres.');
    await node('reset-local-admin.ts',{},JSON.stringify({login,password}));
    return {ok:true};
   },
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
