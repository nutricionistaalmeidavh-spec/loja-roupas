// Verifica que a edição comercial instalada exige ativação antes de criar a loja.
import {strict as assert} from 'node:assert';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const {_electron:electron}=require('@playwright/test');
const executablePath=process.argv[2];
if(!executablePath||!path.isAbsolute(executablePath))throw Error('Electron absoluto obrigatório');
const userData=await mkdtemp(path.join(tmpdir(),'loja-comercial-'));
let instance;
try{
 const env={...process.env};
 delete env.LOJA_SERVER_URL;
 instance=await electron.launch({executablePath,args:['--user-data-dir='+userData],
  chromiumSandbox:true,env,timeout:45000});
 const setup=await instance.firstWindow({timeout:25000});
 await setup.getByRole('heading',{name:'Ative sua licença comercial'}).waitFor({timeout:60000});
 assert.equal(await setup.getByRole('heading',{name:'Crie sua loja'}).isVisible().catch(()=>false),false,
  'A loja não pode ser criada antes da ativação');
 assert.ok(await setup.locator('form#activation input[name=code]').isVisible(),'Campo do código ausente');
 const license=JSON.parse(await readFile(path.join(userData,'commercial-license.json'),'utf8'));
 assert.equal(license.active,false);
 assert.match(license.installationId,/^loja-[a-f0-9-]{36}$/);
 console.info('Edição comercial exige ativação:',license.installationId);
}finally{
 await instance?.close().catch(()=>{});
 await rm(userData,{recursive:true,force:true}).catch(()=>{});
}
